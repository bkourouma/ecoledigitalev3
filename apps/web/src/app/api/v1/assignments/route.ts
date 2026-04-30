import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

export async function GET(request: NextRequest) {
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
    
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    
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

    console.log('🔍 ASSIGNMENTS API: Fetching assignments', {
      tenantId: headers['X-Tenant'],
      userId: headers['X-User-Id'],
      queryParams: queryString,
      hasAuthHeader: !!authorization
    });

    const response = await fetch(`${API_BASE_URL}/api/v1/assignments?${queryString}`, {
      method: 'GET',
      headers,
    });

    console.log('📊 ASSIGNMENTS API: Backend response status:', response.status);

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ ASSIGNMENTS API: Backend error:', response.status, errorData);
      
      let errorMessage = 'Failed to fetch assignments';
      try {
        const errorJson = JSON.parse(errorData);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch {
        errorMessage = errorData || errorMessage;
      }

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ ASSIGNMENTS API: Successfully fetched assignments:', {
      count: data.assignments?.length || data.data?.length || 0,
      total: data.total || 0
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('❌ ASSIGNMENTS API: Error fetching assignments:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get Authorization header from request
    const authorization = request.headers.get('Authorization');
    
    // Get request body
    const body = await request.json();
    
    // Build headers for backend request
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Tenant': session.tenantId || 'imhotepacademy',
      'X-User-Id': session.user.id,
    };

    // Forward Authorization header if present
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    console.log('🔍 ASSIGNMENTS API: Creating assignment', {
      tenantId: headers['X-Tenant'],
      userId: headers['X-User-Id'],
    });

    const response = await fetch(`${API_BASE_URL}/api/v1/assignments`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ ASSIGNMENTS API: Backend error:', response.status, errorData);
      
      let errorMessage = 'Failed to create assignment';
      try {
        const errorJson = JSON.parse(errorData);
        errorMessage = errorJson.error || errorJson.message || errorMessage;
      } catch {
        errorMessage = errorData || errorMessage;
      }

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('❌ ASSIGNMENTS API: Error creating assignment:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

