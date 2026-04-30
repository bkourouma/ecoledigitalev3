import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get session for authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || 'imhotepacademy';
    const userId = request.headers.get('X-User-Id') || session.user.id;
    const studentId = request.headers.get('X-Student-Id');

    console.log('🔍 ASSIGNMENT INSTANCE API: Fetching assignment instance:', {
      instanceId: id,
      tenantId,
      userId,
      studentId
    });

    // Forward the request to the backend API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
                };

    // Add student ID if provided
    if (studentId) {
      headers['X-Student-Id'] = studentId;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/assignment-instances/${id}`, {
      method: 'GET',
      headers
    });

    console.log('📊 ASSIGNMENT INSTANCE API: Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ ASSIGNMENT INSTANCE API: Backend error:', response.status, errorText);
      
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Assignment instance not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch assignment instance' },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ ASSIGNMENT INSTANCE API: Assignment instance fetched successfully');
    
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ ASSIGNMENT INSTANCE API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}



