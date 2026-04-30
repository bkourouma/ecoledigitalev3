import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:4000' 
  : process.env.API_URL || 'http://localhost:4000';

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
    const fileUrl = searchParams.get('fileUrl');
    
    if (!fileUrl) {
      return NextResponse.json(
        { success: false, error: 'fileUrl parameter required' },
        { status: 400 }
      );
    }

    console.log('🔍 Debug file access:', {
      fileUrl,
      userId: session.user.id,
      tenantId: session.tenantId,
      userEmail: session.user.email
    });

    // Parse the file URL to extract components
    const urlParts = fileUrl.split('/');
    console.log('URL parts:', urlParts);

    if (urlParts.length < 6 || urlParts[1] !== 'api' || urlParts[2] !== 'v1' || urlParts[3] !== 'files') {
      return NextResponse.json({
        success: false,
        error: 'Invalid file URL format',
        debug: {
          urlParts,
          expected: '/api/v1/files/{tenantId}/{assignmentId}/{filename}'
        }
      });
    }

    const tenantId = urlParts[4];
    const assignmentId = urlParts[5];
    const filename = urlParts.slice(6).join('/'); // Handle filenames with slashes

    console.log('Parsed components:', {
      tenantId,
      assignmentId,
      filename
    });

    // Test backend connectivity first
    try {
      const healthResponse = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
        timeout: 5000
      });
      
      console.log('Backend health check:', {
        status: healthResponse.status,
        ok: healthResponse.ok
      });
    } catch (healthError) {
      console.error('Backend health check failed:', healthError);
      return NextResponse.json({
        success: false,
        error: 'Backend server not accessible',
        debug: {
          backendUrl: API_BASE_URL,
          error: healthError instanceof Error ? healthError.message : 'Unknown error'
        }
      });
    }

    // Test the actual file request
    const backendFileUrl = `${API_BASE_URL}${fileUrl}`;
    console.log('Testing backend file URL:', backendFileUrl);

    const response = await fetch(backendFileUrl, {
      method: 'GET',
      headers: {
        'X-Tenant': session.tenantId || 'imhotepacademy',
        'User-Agent': 'NextJS-Debug/1.0',
      },
      timeout: 10000
    });

    console.log('Backend response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    let responseBody = '';
    try {
      responseBody = await response.text();
      console.log('Backend response body:', responseBody);
    } catch (bodyError) {
      console.error('Could not read response body:', bodyError);
    }

    return NextResponse.json({
      success: response.ok,
      debug: {
        fileUrl,
        backendUrl: backendFileUrl,
        session: {
          userId: session.user.id,
          userEmail: session.user.email,
          tenantId: session.tenantId
        },
        parsedComponents: {
          tenantId,
          assignmentId,
          filename
        },
        backendResponse: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody.substring(0, 500) // Limit body size
        }
      }
    });

  } catch (error) {
    console.error('Debug API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Debug API error',
      debug: {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }
    }, { status: 500 });
  }
}
