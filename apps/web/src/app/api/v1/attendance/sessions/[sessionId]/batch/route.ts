import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
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

    const { sessionId } = await params;

    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || (session as any).tenantId || 'imhotepacademy';
    const userId = request.headers.get('X-User-Id') || session.user.id;

    // Get request body
    const body = await request.json();

    // Forward the request to the backend API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
      'X-User-Id': userId,
    };

    console.log('🔍 BATCH ATTENDANCE API: Batch marking attendance:', {
      sessionId,
      tenantId,
      userId,
      recordsCount: body.attendanceRecords?.length || 0,
      url: `${API_BASE_URL}/api/v1/attendance/sessions/${sessionId}/batch`
    });

    const response = await fetch(`${API_BASE_URL}/api/v1/attendance/sessions/${sessionId}/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    console.log('📊 BATCH ATTENDANCE API: Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText || `HTTP ${response.status}` };
      }
      
      console.error('❌ BATCH ATTENDANCE API: Backend error:', response.status, errorData);
      
      return NextResponse.json(
        { 
          error: errorData.error || 'Failed to batch mark attendance',
          message: errorData.message || errorData.error || `HTTP ${response.status}`
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ BATCH ATTENDANCE API: Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

