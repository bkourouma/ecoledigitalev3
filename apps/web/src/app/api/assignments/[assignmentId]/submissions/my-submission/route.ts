import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  console.log('📋 MY SUBMISSION: Request received');

  try {
    // Get session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      console.error('❌ MY SUBMISSION: No session found');
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Await params (Next.js 15 requirement)
    const { assignmentId } = await params;
    const authorization = request.headers.get('Authorization');

    console.log('📋 MY SUBMISSION: Request details:', {
      assignmentId,
      userId: session.user.id,
      hasAuthHeader: !!authorization
    });

    // Forward the request to the backend API
    const API_BASE_URL = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:4000' 
      : process.env.API_URL || 'http://localhost:4000';

    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions/my-submission`;

    console.log('🔗 MY SUBMISSION: Forwarding to backend:', backendUrl);

    try {
      const headers: HeadersInit = {
        'X-Tenant': '6eb9c106-b650-4398-b6fa-091b6828c4ba',
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

      console.log('📥 MY SUBMISSION: Backend response status:', response.status);

      if (!response.ok) {
        if (response.status === 404) {
          // No submission found - this is normal for new assignments
          console.log('📋 MY SUBMISSION: No submission found');
          return NextResponse.json(null);
        }
        
        const errorText = await response.text();
        console.error('❌ MY SUBMISSION: Backend error:', response.status, errorText);
        
        return NextResponse.json(
          { success: false, error: `Erreur backend: ${response.status}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      console.log('✅ MY SUBMISSION: Data received from backend:', {
        hasData: !!data,
        submissionId: data?.id,
        fileName: data?.submitted_file_name,
        status: data?.status
      });

      return NextResponse.json(data);

    } catch (error) {
      console.error('❌ MY SUBMISSION: Backend request failed:', error);
      return NextResponse.json(
        { success: false, error: 'Erreur de connexion au serveur' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ MY SUBMISSION: API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
