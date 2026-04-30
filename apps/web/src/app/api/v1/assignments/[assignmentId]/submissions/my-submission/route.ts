import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:4000' 
  : process.env.API_URL || 'http://localhost:4000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    // Get session with detailed logging
    const session = await getServerSession(authOptions);

    console.log('🔐 My Submission Session check:', {
      hasSession: !!session,
      hasUser: !!session?.user,
      userId: session?.user?.id,
      tenantId: session?.tenantId,
    });

    if (!session?.user?.id) {
      console.error('❌ No session or user ID found');
      return NextResponse.json(
        { success: false, error: 'Authentification requise' },
        { status: 401 }
      );
    }

    const { assignmentId } = await params;
    const authorization = request.headers.get('Authorization');
    
    console.log('📁 My submission request:', {
      userId: session.user.id,
      assignmentId,
      tenantId: session.tenantId,
      hasAuthHeader: !!authorization
    });

    // Forward the request to the backend API
    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions/my-submission`;

    console.log('🔗 Forwarding to backend:', backendUrl);

    const headers: HeadersInit = {
      'X-Tenant': session.tenantId || 'imhotepacademy',
      'X-User-Id': session.user.id,
      'Content-Type': 'application/json',
    };

    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers,
    });

    console.log('📥 Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Backend error:', response.status, errorText);
      
      if (response.status === 404) {
        // No submission found - this is normal for new assignments
        return NextResponse.json(
          { success: true, data: null },
          { status: 200 }
        );
      }
      
      return NextResponse.json(
        { success: false, error: `Erreur backend: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ My submission data received:', data);

    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ My submission API error:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
