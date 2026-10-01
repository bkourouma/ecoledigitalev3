import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

// PATCH /api/v1/assignments/:assignmentId/submissions/:submissionId - Update submission
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string; submissionId: string }> }
) {
  console.log('🎯 [SUBMISSION UPDATE PROXY] PATCH /api/v1/assignments/[assignmentId]/submissions/[submissionId]');
  
  try {
    // Get session for authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      console.log('❌ [AUTH FAILED] No session or user ID');
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { assignmentId, submissionId } = await params;
    const body = await request.json();

    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || (session as any).tenantSlug || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || session.user.id;

    console.log('🔍 [SUBMISSION UPDATE PROXY] Forwarding to backend');
    console.log('📋 [SUBMISSION UPDATE PROXY] Assignment ID:', assignmentId);
    console.log('📋 [SUBMISSION UPDATE PROXY] Submission ID:', submissionId);
    console.log('📋 [SUBMISSION UPDATE PROXY] User ID:', userId);

    // Forward the request to the backend API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
                };

    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions/${submissionId}`;
    console.log('📤 [SUBMISSION UPDATE PROXY] Calling:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body)
    });

    console.log('📊 [SUBMISSION UPDATE PROXY] Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [SUBMISSION UPDATE PROXY] Backend error:', response.status, errorText);
      
      return NextResponse.json(
        { error: errorText || 'Failed to update submission' },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ [SUBMISSION UPDATE PROXY] Success!');
    
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ [SUBMISSION UPDATE PROXY] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}













