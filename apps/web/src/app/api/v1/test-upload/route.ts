import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET(request: NextRequest) {
  console.log('🧪 Test upload route - GET request received');
  
  try {
    const session = await getServerSession(authOptions);
    
    return NextResponse.json({
      success: true,
      message: 'Test upload route is working',
      session: session ? {
        userId: session.user?.id,
        tenantId: session.tenantId,
        authenticated: true
      } : {
        authenticated: false
      },
      headers: {
        'X-Tenant': request.headers.get('X-Tenant') || request.headers.get('x-tenant'),
        'User-Agent': request.headers.get('User-Agent'),
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Test upload route error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  console.log('🧪 Test upload route - POST request received');
  
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      console.log('❌ No session found');
      return NextResponse.json({
        success: false,
        error: 'Authentication required',
        message: 'No valid session found'
      }, { status: 401 });
    }

    // Try to parse form data
    let formData;
    let hasFile = false;
    let fileInfo = null;

    try {
      formData = await request.formData();
      const file = formData.get('file') as File;
      
      if (file && file instanceof File) {
        hasFile = true;
        fileInfo = {
          name: file.name,
          size: file.size,
          type: file.type
        };
      }
    } catch (error) {
      console.log('❌ Failed to parse form data:', error);
    }

    return NextResponse.json({
      success: true,
      message: 'Test upload route is working - POST',
      session: {
        userId: session.user.id,
        tenantId: session.tenantId,
        authenticated: true
      },
      request: {
        hasFormData: !!formData,
        hasFile,
        fileInfo,
        headers: {
          'X-Tenant': request.headers.get('X-Tenant') || request.headers.get('x-tenant'),
          'Content-Type': request.headers.get('Content-Type'),
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Test upload route POST error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
