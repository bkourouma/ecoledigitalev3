import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 
  (process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Non autorisé - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const { id: materialId } = await params;

    // Prefer tenant_id (UUID) over tenantSlug for better backend resolution
    const tenantIdentifier = (session as any)?.tenantId || (session as any)?.tenantSlug || 'imhotepacademy';

    // Build headers for backend request
    const backendHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantIdentifier,
    };
    
    // Add JWT token if available
    if ((session as any)?.jwtToken) {
      backendHeaders['Authorization'] = `Bearer ${(session as any).jwtToken}`;
    }
    
    // Add user ID header
    if (userId) {
      backendHeaders['X-User-Id'] = userId;
    }

    // Get the download URL from the backend API
    const contentResponse = await fetch(`${API_BASE_URL}/api/v1/courses/materials/${materialId}/content`, {
      headers: backendHeaders
    });

    if (!contentResponse.ok) {
      const errorText = await contentResponse.text();
      return NextResponse.json(
        { error: 'Material not found', details: errorText },
        { status: contentResponse.status }
      );
    }

    const contentData = await contentResponse.json();

    if (!contentData.downloadUrl) {
      return NextResponse.json(
        { error: 'Content URL not available' },
        { status: 404 }
      );
    }

    // Convert backend URL to proxy URL if it's a backend file URL
    // Backend URL format: /api/v1/files/{tenantId}/{courseId}/{filename}
    // Proxy URL format: /api/v1/files/{tenantId}/{courseId}/{filename}
    let downloadUrl = contentData.downloadUrl;
    
    // If the URL is a backend URL, convert it to use the Next.js proxy
    if (downloadUrl.startsWith('/api/v1/files/')) {
      // Keep the same path, it will be handled by the proxy route
      downloadUrl = downloadUrl;
    } else if (downloadUrl.startsWith('http://localhost:4000/api/v1/files/')) {
      // Convert absolute backend URL to relative proxy URL
      downloadUrl = downloadUrl.replace('http://localhost:4000', '');
    }

    // Return the download URL and metadata
    return NextResponse.json({
      downloadUrl,
      fileName: contentData.fileName,
      fileType: contentData.fileType,
      fileSize: contentData.fileSize,
    });

  } catch (error) {
    console.error('Error serving material content:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
