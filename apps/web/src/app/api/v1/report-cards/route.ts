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

    const response = await fetch(`${API_BASE_URL}/api/v1/report-cards?${queryString}`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch report cards' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching report cards:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
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

    // Get Authorization header from request (added by fetch interceptor)
    const authorization = request.headers.get('Authorization');
    
    let body: any = {};
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json(
        { success: false, error: 'Invalid request body' },
        { status: 400 }
      );
    }
    
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

    console.log('📤 Forwarding POST request to backend:', {
      url: `${API_BASE_URL}/api/v1/report-cards`,
      body: JSON.stringify(body),
      hasAuth: !!authorization,
    });

    const response = await fetch(`${API_BASE_URL}/api/v1/report-cards`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    let data: any = {};
    try {
      const text = await response.text();
      console.log('📥 Backend response text:', text);
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
        { 
          success: false, 
          error: data.error || data.message || 'Failed to create report card',
          details: data.details || undefined,
        },
        { status: response.status }
      );
    }

    // Ensure response has success property for successful responses
    // Backend returns { success: true, data: {...} } on success
    // If data is empty or doesn't have success, treat as success if status is 200/201
    if (response.status === 200 || response.status === 201) {
      // If backend response doesn't have success property, add it
      if (data && typeof data === 'object' && !('success' in data)) {
        console.warn('⚠️ Backend response missing success property, adding it');
        data = { success: true, ...data };
      }
      // If data is empty object, create a proper success response
      if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
        console.warn('⚠️ Backend returned empty response, creating success response');
        data = { success: true, data: null, message: 'Report card created successfully' };
      }
    }

    console.log('✅ Forwarding success response:', { status: response.status, hasSuccess: !!data.success });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error creating report card:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

