import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

// POST /api/assignments/:assignmentId/submissions/:submissionId/finalize
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string; submissionId: string }> }
) {
  console.log('🎯 [FINALIZE PROXY] POST /api/assignments/[assignmentId]/submissions/[submissionId]/finalize');

  try {
    // Get session for authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      console.log('❌ [AUTH FAILED] No session or user ID');
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { assignmentId, submissionId } = await params;
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      // No body, use empty object
    }

    // Get headers for backend request
    const authorization = request.headers.get('Authorization') || '';
    const tenantId = (session as any).tenantId || request.headers.get('X-Tenant') || '6eb9c106-b650-4398-b6fa-091b6828c4ba';
    const userId = request.headers.get('X-User-Id') || session.user.id;

    // Forward the request to the backend API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
      'X-User-Id': userId,
    };
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions/${submissionId}/finalize`;
    console.log('📤 [FINALIZE PROXY] Calling:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    console.log('📊 [FINALIZE PROXY] Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [FINALIZE PROXY] Backend error:', response.status, errorText);
      
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText || 'Failed to finalize submission' };
      }
      
      return NextResponse.json(
        { success: false, error: errorData.error || 'Erreur lors de la finalisation de la soumission' },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ [FINALIZE PROXY] Success!');
    
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ [FINALIZE PROXY] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
