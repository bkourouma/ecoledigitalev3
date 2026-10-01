import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;
    
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || session?.user?.id;
    
    const headers: Record<string, string> = {
      'X-Tenant': tenantId,
    };
    
    if (userId) headers['X-User-Id'] = userId;
    
    const authorization = request.headers.get('Authorization');
    if (authorization) headers['Authorization'] = authorization;
    
    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${id}/programme-pdf`;
    
    console.log('📄 FORMATIONS-PRO PDF API: Fetching PDF:', {
      tenantId,
      userId: userId || 'none (public)',
      id,
      url: backendUrl
    });
    
    const response = await fetch(backendUrl, { method: 'GET', headers });
    
    if (!response.ok) {
      // Try to parse error as JSON, but handle cases where it might not be JSON
      let errorData: any;
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP ${response.status}`, message: response.statusText };
        }
      } else {
        const text = await response.text();
        errorData = { 
          error: `HTTP ${response.status}`, 
          message: text || response.statusText || "Failed to generate PDF"
        };
      }
      
      console.error('❌ FORMATIONS-PRO PDF API: Backend error:', {
        status: response.status,
        error: errorData
      });
      
      return NextResponse.json(errorData, { status: response.status });
    }
    
    // Return PDF as blob
    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    
    return new NextResponse(blob, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition || `attachment; filename="programme-${id}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error('❌ FORMATIONS-PRO PDF API: Error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      message: error.message || 'An error occurred while generating PDF'
    }, { status: 500 });
  }
}

