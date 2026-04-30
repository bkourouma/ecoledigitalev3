import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

// Log that this file is being loaded
console.log('🚀 [ROUTE LOADED] /api/v1/student/assignments/[id]/route.ts');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  console.log('🎯 [STUDENT ASSIGNMENT ROUTE HIT] GET /api/v1/student/assignments/[id]');
  
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

    const { id: assignmentId } = await params;

    const sessionAny = session as { tenantSlug?: string; tenantId?: string };
    const tenantId =
      request.headers.get('X-Tenant') ||
      sessionAny.tenantSlug ||
      sessionAny.tenantId ||
      'imhotepacademy';
    const userId = request.headers.get('X-User-Id') || session.user.id;
    const studentId = request.headers.get('X-Student-Id');
    const activeAcademicYearId = request.headers.get('X-Academic-Year-Id');

    console.log('🔍 [STUDENT ASSIGNMENT PROXY] Forwarding to backend');
    console.log('📋 [STUDENT ASSIGNMENT PROXY] Assignment ID:', assignmentId);
    console.log('📋 [STUDENT ASSIGNMENT PROXY] User ID:', userId);
    console.log('📋 [STUDENT ASSIGNMENT PROXY] Tenant:', tenantId);

    // Forward the request to the backend API student assignments endpoint
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
      'X-User-Id': userId,
    };

    // Add student ID if provided
    if (studentId) {
      headers['X-Student-Id'] = studentId;
    }
    if (activeAcademicYearId) {
      headers['X-Academic-Year-Id'] = activeAcademicYearId;
    }

    const backendUrl = `${API_BASE_URL}/api/v1/student/assignments/${assignmentId}`;
    console.log('📤 [STUDENT ASSIGNMENT PROXY] Calling:', backendUrl);

    // Call the student assignments endpoint (which expects instance IDs)
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers
    });

    console.log('📊 [STUDENT ASSIGNMENT PROXY] Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [STUDENT ASSIGNMENT PROXY] Backend error:', response.status, errorText);
      
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Assignment not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch assignment' },
        { status: response.status }
      );
    }

    const assignmentData = await response.json();
    console.log('✅ [STUDENT ASSIGNMENT PROXY] Success! Returning data to frontend');
    
    return NextResponse.json(assignmentData);

  } catch (error) {
    console.error('❌ [STUDENT ASSIGNMENT PROXY] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

