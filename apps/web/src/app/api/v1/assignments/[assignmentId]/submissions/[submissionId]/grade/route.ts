import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:4000' 
  : process.env.API_URL || 'http://localhost:4000';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string; submissionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { assignmentId, submissionId } = await params;
    
    if (!assignmentId || !submissionId) {
      return NextResponse.json(
        { success: false, error: 'Assignment ID and Submission ID are required' },
        { status: 400 }
      );
    }

    // Get the request body
    const body = await request.json();
    const { manual_score, feedback } = body;

    if (manual_score === undefined || manual_score === null) {
      return NextResponse.json(
        { success: false, error: 'Manual score is required' },
        { status: 400 }
      );
    }

    console.log('📝 Grading submission:', {
      assignmentId,
      submissionId,
      manual_score,
      feedback: feedback ? 'provided' : 'none',
      userId: session.user.id
    });

    // Get JWT token from session
    const jwtToken = (session as any).jwtToken;
    
    if (!jwtToken) {
      console.error('❌ No JWT token in session');
      return NextResponse.json(
        { success: false, error: 'Authentication token missing' },
        { status: 401 }
      );
    }

    // Forward the request to the backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions/${submissionId}/grade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': (session as any)?.tenantId || tenantFallback(request),
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        manual_score,
        feedback
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Backend API error:', response.status, data);
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to grade submission' },
        { status: response.status }
      );
    }

    console.log('✅ Submission graded successfully:', data);
    return NextResponse.json(data);

  } catch (error) {
    console.error('Grade submission API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
