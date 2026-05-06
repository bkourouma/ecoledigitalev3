import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(request: NextRequest) {
  try {
    // Get session for authentication (optional for public catalog)
    const session = await getServerSession(authOptions);
    
    // Get query parameters from the request
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    
    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || 'imhotepdata';
    const userId = request.headers.get('X-User-Id') || session?.user?.id;
    
    // Build headers for backend request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };

    // Add X-User-Id if available
    if (userId) {
      headers['X-User-Id'] = userId;
    }

    // Forward Authorization header when present so the backend can resolve
    // tenant from the JWT (avoids defaulting to a wrong tenant slug for
    // logged-in admin/owner users).
    const incomingAuth = request.headers.get('authorization');
    if (incomingAuth) {
      headers['Authorization'] = incomingAuth;
    }

    // Build the backend URL with query parameters
    const backendUrl = queryString
      ? `${API_BASE_URL}/api/v1/formations-pro?${queryString}`
      : `${API_BASE_URL}/api/v1/formations-pro`;
    
    console.log('🔍 FORMATIONS-PRO API: Fetching formations:', {
      tenantId,
      userId: userId || 'none (public)',
      queryString,
      url: backendUrl
    });
    
    try {
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers,
      });
      
      console.log('📊 FORMATIONS-PRO API: Backend response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        
        console.error('❌ FORMATIONS-PRO API: Backend error:', {
          status: response.status,
          error: errorData,
          errorText
        });
        
        return NextResponse.json(
          { error: errorData.error || errorData.message || `HTTP ${response.status}` },
          { status: response.status }
        );
      }
      
      const data = await response.json();
      console.log('✅ FORMATIONS-PRO API: Success, formations count:', data?.data?.formations?.length || 0);
      
      return NextResponse.json(data);
    } catch (fetchError: any) {
      console.error('❌ FORMATIONS-PRO API: Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to connect to backend API', details: fetchError.message },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('❌ FORMATIONS-PRO API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get session for authentication
    const session = await getServerSession(authOptions);
    
    // Get body from the request
    const body = await request.json();
    
    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || 'imhotepdata';
    const userId = request.headers.get('X-User-Id') || session?.user?.id;
    
    // Build headers for backend request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };

    // Add X-User-Id if available
    if (userId) {
      headers['X-User-Id'] = userId;
    }

    const incomingAuth = request.headers.get('authorization');
    if (incomingAuth) {
      headers['Authorization'] = incomingAuth;
    }

    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro`;
    
    console.log('🔍 FORMATIONS-PRO API: Creating formation:', {
      tenantId,
      userId: userId || 'none',
      url: backendUrl
    });
    
    try {
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      
      console.log('📊 FORMATIONS-PRO API: Backend response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        
        console.error('❌ FORMATIONS-PRO API: Backend error:', {
          status: response.status,
          error: errorData,
          errorText
        });
        
        return NextResponse.json(
          { error: errorData.error || errorData.message || `HTTP ${response.status}` },
          { status: response.status }
        );
      }
      
      const data = await response.json();
      console.log('✅ FORMATIONS-PRO API: Success, created formation:', data?.data?.id);
      
      return NextResponse.json(data, { status: 201 });
    } catch (fetchError: any) {
      console.error('❌ FORMATIONS-PRO API: Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to connect to backend API', details: fetchError.message },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('❌ FORMATIONS-PRO API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

