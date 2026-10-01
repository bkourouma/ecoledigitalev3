import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  console.log('📤 NEW ENDPOINT: Submission upload request received');

  try {
    // Get session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      console.error('❌ No session found for upload');
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Await params (Next.js 15 requirement)
    const { assignmentId } = await params;

    console.log('📋 NEW ENDPOINT: Upload request details:', {
      assignmentId,
      userId: session.user.id,
      hasSession: !!session
    });
    
    // Get the form data from the request
    let formData;
    try {
      formData = await request.formData();
      console.log('📦 NEW ENDPOINT: Form data received:', {
        hasFile: formData.has('file'),
        fileCount: Array.from(formData.keys()).length,
        keys: Array.from(formData.keys())
      });
    } catch (error) {
      console.error('❌ Failed to parse form data:', error);
      return NextResponse.json(
        { success: false, error: 'Invalid form data' },
        { status: 400 }
      );
    }

    // Validate file
    const file = formData.get('file') as File;
    if (!file || !(file instanceof File)) {
      console.error('❌ No valid file found in form data');
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    console.log('📁 NEW ENDPOINT: File details:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    console.log('📤 UPLOAD: Forwarding to backend API:', {
      assignmentId,
      userId: session.user.id,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    });

    // Validate file type (PDF only)
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      console.error('❌ Invalid file type:', file.type);
      return NextResponse.json(
        { success: false, error: 'Seuls les fichiers PDF sont acceptés' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      console.error('❌ File too large:', file.size);
      return NextResponse.json(
        { success: false, error: 'Le fichier est trop volumineux (max 10MB)' },
        { status: 400 }
      );
    }

    // Forward the upload to the backend API
    try {
      console.log('🔄 Forwarding upload to backend API...');

      // Get Authorization header from request (added by fetch interceptor)
      const authorization = request.headers.get('Authorization');
      
      console.log('🔐 Upload auth check:', {
        hasAuthHeader: !!authorization,
        userId: session.user.id,
        tenantId: session.tenantId || tenantFallback(request)
      });

      // Create a new FormData for the backend request
      const backendFormData = new FormData();
      backendFormData.append('file', file);
      backendFormData.append('assignmentId', assignmentId);

      // Build headers for backend request
      const headers: HeadersInit = {
        'X-Tenant': session.tenantId || tenantFallback(request),
        'X-User-Id': session.user.id,
      };

      // Forward Authorization header if present (JWT token)
      if (authorization) {
        headers['Authorization'] = authorization;
        console.log('✅ JWT token forwarded to backend');
      } else {
        console.warn('⚠️  No Authorization header found - backend may reject request');
      }

      const response = await fetch(`${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions/upload`, {
        method: 'POST',
        headers,
        body: backendFormData,
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('❌ Backend upload failed:', response.status, data);
        return NextResponse.json(
          { success: false, error: data.error || 'Upload failed' },
          { status: response.status }
        );
      }

      console.log('✅ File uploaded successfully via backend:', data);

      return NextResponse.json({
        success: true,
        data: data.data,
        message: "Fichier téléchargé avec succès"
      });

    } catch (error) {
      console.error('❌ File upload error:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Erreur lors du téléchargement du fichier',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ General error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erreur interne du serveur',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
