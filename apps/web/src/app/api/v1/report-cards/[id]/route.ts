import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

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
      'X-Tenant': session.tenantId || tenantFallback(request),
      'X-User-Id': session.user.id,
    };

    // Forward Authorization header if present (JWT token)
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/report-cards/${id}`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || data.message || 'Failed to fetch report card' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching report card:', error);
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
      'X-Tenant': session.tenantId || tenantFallback(request),
      'X-User-Id': session.user.id,
    };

    // Forward Authorization header if present (JWT token)
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/report-cards/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    let data: any = {};
    try {
      const text = await response.text();
      console.log('📥 Backend PUT response text:', text);
      if (text) {
        data = JSON.parse(text);
      }
    } catch (parseError) {
      console.error('❌ Failed to parse backend response:', parseError);
      return NextResponse.json(
        { success: false, error: 'Invalid response from backend' },
        { status: 500 }
      );
    }

    if (!response.ok) {
      console.error('❌ Backend error:', {
        status: response.status,
        statusText: response.statusText,
        data,
      });
      return NextResponse.json(
        { success: false, error: data.error || data.message || 'Failed to update report card' },
        { status: response.status }
      );
    }

    // Ensure response has success property for successful responses
    if (response.status === 200 || response.status === 201) {
      if (data && typeof data === 'object' && !('success' in data)) {
        console.warn('⚠️ Backend response missing success property, adding it');
        data = { success: true, ...data };
      }
      if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        console.warn('⚠️ Backend returned empty response, creating success response');
        data = { success: true, data: null, message: 'Report card updated successfully' };
      }
    }

    console.log('✅ Forwarding PUT success response:', { status: response.status, hasSuccess: !!data.success });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating report card:', error);
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
      'X-Tenant': session.tenantId || tenantFallback(request),
      'X-User-Id': session.user.id,
    };

    // Forward Authorization header if present (JWT token)
    if (authorization) {
      headers['Authorization'] = authorization;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/report-cards/${id}`, {
      method: 'DELETE',
      headers,
    });

    let data: any = {};
    try {
      const text = await response.text();
      console.log('📥 Backend DELETE response text:', text);
      if (text) {
        data = JSON.parse(text);
      }
    } catch (parseError) {
      console.error('❌ Failed to parse backend response:', parseError);
      return NextResponse.json(
        { success: false, error: 'Invalid response from backend' },
        { status: 500 }
      );
    }

    if (!response.ok) {
      console.error('❌ Backend error:', {
        status: response.status,
        statusText: response.statusText,
        data,
      });
      return NextResponse.json(
        { success: false, error: data.error || data.message || 'Failed to delete report card' },
        { status: response.status }
      );
    }

    // Ensure response has success property for successful responses
    if (response.status === 200 || response.status === 204) {
      if (data && typeof data === 'object' && !('success' in data)) {
        console.warn('⚠️ Backend response missing success property, adding it');
        data = { success: true, ...data };
      }
      if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        console.warn('⚠️ Backend returned empty response, creating success response');
        data = { success: true, data: null, message: 'Report card deleted successfully' };
      }
    }

    console.log('✅ Forwarding DELETE success response:', { status: response.status, hasSuccess: !!data.success });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error deleting report card:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

