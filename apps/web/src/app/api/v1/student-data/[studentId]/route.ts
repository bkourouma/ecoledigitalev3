import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
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

    const { studentId } = await params;

    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || 'imhotepacademy';
    const userId = request.headers.get('X-User-Id') || session.user.id;

    console.log('🔍 STUDENT API: Fetching student data:', {
      studentId,
      tenantId,
      userId
    });

    // Forward the request to the backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/students/${studentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenantId,
                      }
    });

    console.log('📊 STUDENT API: Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ STUDENT API: Backend error:', response.status, errorText);
      
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Student not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch student data' },
        { status: response.status }
      );
    }

    const studentData = await response.json();
    console.log('✅ STUDENT API: Student data fetched successfully');
    
    return NextResponse.json(studentData);

  } catch (error) {
    console.error('❌ STUDENT API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
