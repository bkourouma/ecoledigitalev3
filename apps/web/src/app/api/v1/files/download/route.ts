import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const fileUrl = searchParams.get('url');
    const assignmentId = searchParams.get('assignmentId');
    
    if (!fileUrl || !assignmentId) {
      return NextResponse.json(
        { success: false, error: 'File URL and assignment ID are required' },
        { status: 400 }
      );
    }

    // Forward the request to the backend API
    const backendUrl = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:4000' 
      : process.env.API_URL || 'http://localhost:4000';

    // Extract tenant ID from the file URL
    const urlParts = fileUrl.split('/');
    const tenantId = urlParts[4]; // /api/v1/files/{tenantId}/...

    const response = await fetch(`${backendUrl}${fileUrl}`, {
      method: 'GET',
      headers: {
        'X-Tenant': tenantId,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: 'File not found or access denied' },
        { status: response.status }
      );
    }

    // Get the file content
    const fileBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/pdf';
    const contentDisposition = response.headers.get('content-disposition') || `attachment; filename="devoir.pdf"`;

    // Return the file with proper headers
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    console.error('Error downloading file:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
