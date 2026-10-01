import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

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
    const tenantId = request.headers.get('X-Tenant') || (session as any).tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || session.user.id;

    // Forward the request to the backend API
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
      'X-User-Id': userId,
    };

    console.log('🔍 SESSION INSTANCE API: Fetching session instance:', {
      id,
      tenantId,
      userId,
      url: `${API_BASE_URL}/api/v1/attendance/session-instances/${id}`
    });

    const response = await fetch(`${API_BASE_URL}/api/v1/attendance/session-instances/${id}`, {
      method: 'GET',
      headers
    });

    console.log('📊 SESSION INSTANCE API: Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ SESSION INSTANCE API: Backend error:', response.status, errorText);
      
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Session instance not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch session instance' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ SESSION INSTANCE API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

