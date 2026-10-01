import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:4000' 
  : process.env.API_URL || 'http://localhost:4000';

export async function POST(request: NextRequest) {
  console.log('📁 Assignment download request received');

  try {
    // Get session with error handling
    let session;
    try {
      session = await getServerSession(authOptions);
      console.log('🔐 Session retrieved successfully');
    } catch (sessionError) {
      console.error('❌ Session retrieval error:', sessionError);
      return NextResponse.json(
        { success: false, error: 'Erreur de session. Veuillez vous reconnecter.' },
        { status: 401 }
      );
    }

    console.log('🔐 Session details:', {
      hasSession: !!session,
      hasUser: !!session?.user,
      userId: session?.user?.id,
      userEmail: session?.user?.email,
      tenantId: session?.tenantId,
      tenantSlug: session?.tenantSlug
    });

    if (!session?.user?.id) {
      console.error('❌ No session or user ID found');
      return NextResponse.json(
        { success: false, error: 'Session non trouvée. Veuillez vous reconnecter.' },
        { status: 401 }
      );
    }

    // Get request body with error handling
    let body;
    try {
      body = await request.json();
      console.log('📦 Request body parsed successfully');
    } catch (bodyError) {
      console.error('❌ Request body parsing error:', bodyError);
      return NextResponse.json(
        { success: false, error: 'Corps de requête invalide' },
        { status: 400 }
      );
    }

    const { fileUrl, assignmentId, fileName } = body;

    if (!fileUrl) {
      console.error('❌ No fileUrl provided in request');
      return NextResponse.json(
        { success: false, error: 'URL du fichier requise' },
        { status: 400 }
      );
    }

    console.log('📁 Download request details:', {
      fileUrl,
      assignmentId,
      fileName,
      userId: session.user.id,
      tenantId: session.tenantId,
      requestHeaders: Object.fromEntries(request.headers.entries())
    });

    // Construct backend URL
    const backendUrl = fileUrl.startsWith('http') ? fileUrl : `${API_BASE_URL}${fileUrl}`;
    
    console.log('🔗 Forwarding to backend:', backendUrl);

    // Forward the request to the backend API
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'X-Tenant': session.tenantId || tenantFallback(request),
        'User-Agent': 'NextJS-Assignment-Download/1.0',
      },
    });

    console.log('📡 Backend response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      console.error('Backend file error:', response.status, response.statusText);
      
      let errorMessage = 'Erreur lors de la récupération du fichier';
      try {
        const errorText = await response.text();
        console.error('Backend error response:', errorText);
        
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: response.status }
      );
    }

    // Get the file content
    const fileBuffer = await response.arrayBuffer();
    
    if (fileBuffer.byteLength === 0) {
      return NextResponse.json(
        { success: false, error: 'Le fichier est vide' },
        { status: 404 }
      );
    }

    // Get content type from backend response
    const contentType = response.headers.get('content-type') || 'application/pdf';
    const originalDisposition = response.headers.get('content-disposition');
    const disposition = originalDisposition || `attachment; filename="${fileName || 'document.pdf'}"`;

    console.log('✅ File downloaded successfully:', {
      size: fileBuffer.byteLength,
      contentType,
      disposition
    });

    // Return the file with proper headers
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Content-Length': fileBuffer.byteLength.toString(),
        'Cache-Control': 'private, no-cache',
      },
    });

  } catch (error) {
    console.error('Assignment download API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erreur interne du serveur',
        debug: process.env.NODE_ENV === 'development' ? {
          message: error instanceof Error ? error.message : 'Unknown error'
        } : undefined
      },
      { status: 500 }
    );
  }
}
