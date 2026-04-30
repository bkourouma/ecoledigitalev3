import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get Authorization header from request (added by fetch interceptor)
    const authorization = request.headers.get('Authorization');
    
    const { id } = await params;
    
    // Build headers for backend request
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Tenant': session.tenantId || 'imhotepacademy',
      'X-User-Id': session.user.id,
    };

    // Forward Authorization header if present (JWT token)
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/exam-schedules/${id}`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || data.message || 'Failed to fetch exam schedule' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching exam schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get Authorization header from request (added by fetch interceptor)
    const authorization = request.headers.get('Authorization');
    
    const { id } = await params;
    const body = await request.json();
    
    // Build headers for backend request
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Tenant': session.tenantId || 'imhotepacademy',
      'X-User-Id': session.user.id,
    };

    // Forward Authorization header if present (JWT token)
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/exam-schedules/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || data.message || 'Failed to update exam schedule' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating exam schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get Authorization header from request (added by fetch interceptor)
    const authorization = request.headers.get('Authorization');
    
    const { id } = await params;
    
    // Build headers for backend request
    const headers: HeadersInit = {
      'X-Tenant': session.tenantId || 'imhotepacademy',
      'X-User-Id': session.user.id,
    };

    // Forward Authorization header if present (JWT token)
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/exam-schedules/${id}`, {
      method: 'DELETE',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || data.message || 'Failed to delete exam schedule' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error deleting exam schedule:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

