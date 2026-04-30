import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

// POST /api/v1/assignments/:assignmentId/submissions - Create submission
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  console.log('🎯 [SUBMISSION CREATE PROXY] POST /api/v1/assignments/[assignmentId]/submissions');
  
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

    const { assignmentId } = await params;
    const body = await request.json();

    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || (session as any).tenantSlug || 'imhotepacademy';
    const userId = request.headers.get('X-User-Id') || session.user.id;

    console.log('🔍 [SUBMISSION CREATE PROXY] Forwarding to backend');
    console.log('📋 [SUBMISSION CREATE PROXY] Assignment ID:', assignmentId);
    console.log('📋 [SUBMISSION CREATE PROXY] User ID:', userId);
    console.log('📋 [SUBMISSION CREATE PROXY] Tenant:', tenantId);

    // Forward the request to the backend API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };

    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions`;
    console.log('📤 [SUBMISSION CREATE PROXY] Calling:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    console.log('📊 [SUBMISSION CREATE PROXY] Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [SUBMISSION CREATE PROXY] Backend error:', response.status, errorText);
      
      return NextResponse.json(
        { error: errorText || 'Failed to create submission' },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ [SUBMISSION CREATE PROXY] Success!');
    
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ [SUBMISSION CREATE PROXY] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

