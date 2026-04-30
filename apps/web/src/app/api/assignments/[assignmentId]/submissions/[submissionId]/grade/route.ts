import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string; submissionId: string }> }
) {
  console.log('📝 GRADE SUBMISSION: Request received');

  try {
    // Get session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      console.error('❌ GRADE SUBMISSION: No session found');
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Await params (Next.js 15 requirement)
    const { assignmentId, submissionId } = await params;

    console.log('📝 GRADE SUBMISSION: Request details:', {
      assignmentId,
      submissionId,
      teacherId: session.user.id
    });

    // Get request body
    let body;
    try {
      body = await request.json();
      console.log('📋 GRADE SUBMISSION: Request body:', body);
    } catch (error) {
      console.error('❌ GRADE SUBMISSION: Invalid JSON body');
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { manual_score, feedback } = body;

    // Validate score
    if (manual_score === undefined || manual_score === null) {
      return NextResponse.json(
        { success: false, error: 'Manual score is required' },
        { status: 400 }
      );
    }

    const score = parseFloat(manual_score);
    if (isNaN(score) || score < 0 || score > 20) {
      return NextResponse.json(
        { success: false, error: 'Score must be between 0 and 20' },
        { status: 400 }
      );
    }

    console.log('🎯 GRADE SUBMISSION: Forwarding to backend API:', {
      assignmentId,
      submissionId,
      manual_score: score,
      feedback: feedback ? 'provided' : 'none',
      userId: session.user.id
    });

    // Get JWT token from session
    const jwtToken = (session as any).jwtToken;
    
    if (!jwtToken) {
      console.error('❌ GRADE SUBMISSION: No JWT token in session');
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
        'X-Tenant': 'imhotepacademy',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        manual_score: score,
        feedback: feedback || null,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Backend grading failed:', response.status, data);
      return NextResponse.json(
        { success: false, error: data.error || 'Grading failed' },
        { status: response.status }
      );
    }

    console.log('✅ Submission graded successfully:', data);
    return NextResponse.json({
      success: true,
      data: data,
      message: 'Note enregistrée avec succès'
    });

  } catch (error) {
    console.error('❌ GRADE SUBMISSION: API error:', error);
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
