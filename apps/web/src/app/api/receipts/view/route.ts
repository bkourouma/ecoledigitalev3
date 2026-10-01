import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

function extractUserIdFromAuth(authHeader?: string | null): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(' ');
  const token = parts.length === 2 ? parts[1] : parts[0];
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return undefined;
    const b64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.userId || payload.sub;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get session from cookies
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Authentication Required', message: 'No authentication token provided' },
        { status: 401 }
      );
    }

    // Extract authentication info from session
    const userId = (session.user as any)?.id || (session as any)?.userId || '';
    const tenantId = (session as any)?.tenantId || (session as any)?.tenantSlug || tenantFallback(request);
    const authorization = (session as any)?.jwtToken ? `Bearer ${(session as any).jwtToken}` : '';

    // Get the receipt URL from query parameters
    const { searchParams } = new URL(request.url);
    const receiptUrl = searchParams.get('url');

    if (!receiptUrl) {
      return NextResponse.json(
        { success: false, error: 'Receipt URL is required' },
        { status: 400 }
      );
    }

    // If it's a full URL, extract the path
    let receiptPath = receiptUrl;
    if (receiptUrl.startsWith('http')) {
      const url = new URL(receiptUrl);
      receiptPath = url.pathname + url.search;
    }

    // If it's a generate endpoint, we need to handle it differently
    if (receiptPath.includes('/api/v1/receipts/generate/')) {
      // Extract transaction ID from the path
      const match = receiptPath.match(/\/api\/v1\/receipts\/generate\/([^/?]+)/);
      if (match && match[1]) {
        const transactionId = match[1];
        // Extract format from original URL or default to pdf
        const originalUrl = new URL(receiptUrl.startsWith('http') ? receiptUrl : `http://localhost${receiptUrl}`);
        const format = originalUrl.searchParams.get('format') || 'pdf';
        
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Tenant': tenantId,
        };
        if (userId) headers['X-User-Id'] = userId;
        if (authorization) headers['Authorization'] = authorization;

        const response = await fetch(
          `${API_BASE_URL}/api/v1/receipts/generate/${transactionId}?format=${format}`,
          {
            method: 'POST',
            headers,
            // Send empty JSON body to satisfy Fastify's Content-Type requirement
            body: JSON.stringify({}),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          return NextResponse.json(
            { success: false, error: errorData.error || 'Failed to generate receipt', message: errorData.message },
            { status: response.status }
          );
        }

        const data = await response.json();
        const generatedReceiptUrl = data.data?.receiptUrl;

        if (generatedReceiptUrl) {
          // If the generated URL is a file path, proxy it
          if (generatedReceiptUrl.startsWith('/api/v1/files/receipts/')) {
            const fileHeaders: Record<string, string> = {
              'X-Tenant': tenantId,
            };
            if (userId) fileHeaders['X-User-Id'] = userId;
            if (authorization) fileHeaders['Authorization'] = authorization;

            const fileResponse = await fetch(`${API_BASE_URL}${generatedReceiptUrl}`, {
              method: 'GET',
              headers: fileHeaders,
            });

            if (fileResponse.ok) {
              const contentType = fileResponse.headers.get('content-type') || 'application/pdf';
              const fileBuffer = await fileResponse.arrayBuffer();
              return new NextResponse(fileBuffer, {
                headers: {
                  'Content-Type': contentType,
                  'Content-Disposition': `inline; filename="${generatedReceiptUrl.split('/').pop()}"`,
                },
              });
            }
          }
          
          // Otherwise redirect to the generated receipt URL
          const finalUrl = generatedReceiptUrl.startsWith('http')
            ? generatedReceiptUrl
            : `${API_BASE_URL}${generatedReceiptUrl}`;
          return NextResponse.redirect(finalUrl);
        }
      }
    }

    // For file receipts, proxy the request with headers
    if (receiptPath.startsWith('/api/v1/files/receipts/')) {
      const headers: Record<string, string> = {
        'X-Tenant': tenantId,
      };
      if (userId) headers['X-User-Id'] = userId;
      if (authorization) headers['Authorization'] = authorization;

      const response = await fetch(`${API_BASE_URL}${receiptPath}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        // If the file doesn't exist, try to generate it from the transaction ID
        // Extract receipt number from filename
        const filename = receiptPath.split('/').pop() || '';
        const receiptNumberMatch = filename.match(/REC-?([a-f0-9-]+)/i);
        
        if (receiptNumberMatch) {
          // Try to find the transaction and generate receipt
          // For now, return the error but log it
          console.error('Receipt file not found, might need generation:', filename);
        }
        
        const errorData = await response.text().catch(() => '');
        return NextResponse.json(
          { success: false, error: 'Failed to fetch receipt file', details: errorData },
          { status: response.status }
        );
      }

      // Get the content type from the response
      const contentType = response.headers.get('content-type') || 'application/pdf';
      const fileBuffer = await response.arrayBuffer();

      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${receiptPath.split('/').pop()}"`,
        },
      });
    }

    // For other URLs, redirect with headers (this won't work for direct file access)
    // Better to proxy the file
    return NextResponse.json(
      { success: false, error: 'Unsupported receipt URL format' },
      { status: 400 }
    );

  } catch (error) {
    console.error('❌ RECEIPT VIEW: API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

