import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

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

    console.log('🚀 Submitting assignment:', {
      assignmentId,
      submissionId,
      userId: session.user.id
    });

    // Forward the request to the backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions/${submissionId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': 'imhotepacademy',
                      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Backend API error:', response.status, data);
      return NextResponse.json(
        { success: false, error: data.error || 'Submission failed' },
        { status: response.status }
      );
    }

    console.log('✅ Assignment submitted successfully:', data);
    return NextResponse.json(data);

  } catch (error) {
    console.error('Submit API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
