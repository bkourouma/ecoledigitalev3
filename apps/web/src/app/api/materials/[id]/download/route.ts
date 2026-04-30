import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: materialId } = await params;
    const session = await getServerSession(authOptions);
    
    // Get tenant and user ID from session or headers
    const tenant = session?.tenantId || request.headers.get('X-Tenant') || 'imhotepacademy';
    const userId = session?.user?.id || request.headers.get('X-User-Id') || '634a57fe-2007-4ecb-ae5b-f9e3152a24fb';
    const auth = request.headers.get('Authorization');

    // Forward the download request to the backend API with download=true to get the file stream
    const response = await fetch(`${API_BASE_URL}/api/v1/courses/materials/${materialId}/content?download=true`, {
      method: 'GET',
      headers: {
        "X-Tenant": tenant,
        "X-User-Id": userId,
        ...(auth ? { "Authorization": auth } : {}),
    },
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Backend API error:', response.status, errorData);
      let errorMessage = 'Failed to download material';
      try {
        const errorJson = JSON.parse(errorData);
        errorMessage = errorJson.message || errorJson.error || errorMessage;
      } catch {
        // If errorData is not JSON, use the text as is
        errorMessage = errorData || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    // Get the file buffer from the backend
    const fileBuffer = await response.arrayBuffer();
    
    // Verify buffer is not empty
    if (!fileBuffer || fileBuffer.byteLength === 0) {
      console.error('❌ Empty file buffer received from backend');
      return NextResponse.json(
        { error: 'File is empty or corrupted' },
        { status: 500 }
      );
    }
    
    // Get content type and filename from response headers
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    const contentLength = response.headers.get('Content-Length');
    let contentDisposition = response.headers.get('Content-Disposition') || '';
    
    // Ensure proper encoding for filename in Content-Disposition
    // The backend should already send it correctly, but we ensure it's preserved
    if (!contentDisposition) {
      contentDisposition = 'attachment';
    }
    
    console.log('📦 File download response:', {
      contentType,
      contentLength: contentLength || fileBuffer.byteLength,
      bufferSize: fileBuffer.byteLength,
      contentDisposition
    });
    
    // Create response with file data
    const fileResponse = new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
        'Content-Length': fileBuffer.byteLength.toString(),
        'Cache-Control': 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
    
    return fileResponse;

  } catch (error: any) {
    console.error('Error getting download URL:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to get download URL' },
      { status: 500 }
    );
  }
}
