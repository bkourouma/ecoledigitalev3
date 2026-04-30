import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request: NextRequest) {
  console.log('📁 Direct file download request received');
  
  try {
    // Get session
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      console.error('❌ No session found');
      return NextResponse.json(
        { success: false, error: 'Session requise' },
        { status: 401 }
      );
    }

    // Get request body
    const body = await request.json();
    const { fileUrl, assignmentId, fileName } = body;
    
    console.log('📁 Direct download request:', {
      fileUrl,
      assignmentId,
      fileName,
      userId: session.user.id,
      tenantId: session.tenantId
    });

    if (!fileUrl) {
      return NextResponse.json(
        { success: false, error: 'URL du fichier requise' },
        { status: 400 }
      );
    }

    // Forward the request to the backend API
    const backendUrl = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:4000' 
      : process.env.API_URL || 'http://localhost:4000';

    // Construct the full backend URL
    const backendFileUrl = fileUrl.startsWith('http') ? fileUrl : `${backendUrl}${fileUrl}`;
    
    console.log('🔗 Forwarding to backend:', backendFileUrl);

    try {
      // Forward the request to the backend API
      const response = await fetch(backendFileUrl, {
        method: 'GET',
        headers: {
          'X-Tenant': session.tenantId || 'imhotepacademy',
        },
      });

      console.log('📡 Backend response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        console.error('❌ Backend file error:', response.status, response.statusText);
        
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
        console.error('❌ Empty file received from backend');
        return NextResponse.json(
          { success: false, error: 'Le fichier est vide' },
          { status: 404 }
        );
      }

      console.log('✅ File received from backend:', {
        size: fileBuffer.byteLength,
        contentType: response.headers.get('content-type')
      });

      // Return the file with proper headers
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': response.headers.get('content-type') || 'application/pdf',
          'Content-Disposition': response.headers.get('content-disposition') || `attachment; filename="${fileName || 'document.pdf'}"`,
          'Content-Length': fileBuffer.byteLength.toString(),
          'Cache-Control': 'private, no-cache',
        },
      });

    } catch (fetchError) {
      console.error('❌ Backend fetch error:', fetchError);
      return NextResponse.json(
        { success: false, error: 'Erreur lors de la communication avec le serveur' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ Direct download error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erreur lors de la lecture du fichier',
        debug: process.env.NODE_ENV === 'development' ? {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        } : undefined
      },
      { status: 500 }
    );
  }
}
