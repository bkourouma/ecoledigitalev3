import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';
export const dynamic = "force-dynamic";

function buildProxyHeaders(request: NextRequest, session: Awaited<ReturnType<typeof getServerSession>>) {
  const tenant = session?.tenantId || request.headers.get('X-Tenant') || 'imhotepacademy';
  const userId = session?.user?.id || request.headers.get('X-User-Id') || '';
  const sessionJwt = (session as any)?.jwtToken as string | undefined;
  const authorization = sessionJwt ? `Bearer ${sessionJwt}` : request.headers.get('Authorization');

  const headers: Record<string, string> = {
    'X-Tenant': tenant,
    'X-User-Id': userId,
  };

  if (authorization) {
    headers['Authorization'] = authorization;
  }

  return { headers, tenant, userId, hasAuth: Boolean(authorization) };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { headers, tenant, userId, hasAuth } = buildProxyHeaders(request, session);
    headers['Content-Type'] = 'application/json';

    // Fetch parent directly from backend API
    console.log(`[Parent API] Fetching parent ${id}...`);
    console.log(`[Parent API] Headers:`, { tenant, userId, hasAuth });
    console.log(`[Parent API] Backend URL:`, `${API_BASE_URL}/api/v1/parents/${id}`);
    
    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/v1/parents/${id}`, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
    } catch (fetchError: any) {
      console.error(`[Parent API] Fetch error:`, fetchError);
      const errorMessage = fetchError?.message || 'Failed to connect to backend server';
      return NextResponse.json(
        { success: false, error: 'fetch failed', message: errorMessage },
        { status: 503 }
      );
    }

    console.log(`[Parent API] Response status:`, response.status);

    if (!response.ok) {
      const errorData = await response.text();
      let errorMessage = 'Failed to fetch parent';
      try {
        if (errorData) {
          const errorJson = JSON.parse(errorData);
          errorMessage = errorJson.message || errorJson.error || errorMessage;
        }
      } catch {
        errorMessage = errorData || errorMessage || `HTTP ${response.status}`;
      }
      console.error(`[Parent API] Failed to fetch parent:`, errorMessage);
      return NextResponse.json(
        { success: false, error: errorMessage, message: errorMessage },
        { status: response.status }
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error(`[Parent API] Failed to parse response:`, parseError);
      return NextResponse.json(
        { success: false, error: 'Invalid response from server', message: 'Failed to parse response' },
        { status: 500 }
      );
    }

    console.log(`[Parent API] Found parent:`, { id: data?.data?.id, name: data?.data?.name || data?.data?.email });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Parent API] Error fetching parent:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { headers, tenant, userId } = buildProxyHeaders(request, session);
    const body = await request.json();
    headers['Content-Type'] = 'application/json';

    console.log(`[Parent API] Updating parent ${id}...`);

    const response = await fetch(`${API_BASE_URL}/api/v1/parents/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.text();
      let errorMessage = 'Failed to update parent';
      try {
        if (errorData) {
          const errorJson = JSON.parse(errorData);
          errorMessage = errorJson.message || errorJson.error || errorMessage;
        }
      } catch {
        errorMessage = errorData || errorMessage || `HTTP ${response.status}`;
      }
      console.error(`[Parent API] Failed to update parent:`, errorMessage);
      return NextResponse.json(
        { success: false, error: errorMessage, message: errorMessage },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log(`[Parent API] Parent updated successfully`);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Parent API] Error updating parent:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { headers, tenant, userId } = buildProxyHeaders(request, session);

    console.log(`[Parent API] Deleting parent ${id}...`);

    const response = await fetch(`${API_BASE_URL}/api/v1/parents/${id}`, {
      method: 'DELETE',
      headers,
      // Don't include Content-Type for DELETE requests without body
    });

    if (!response.ok) {
      const errorData = await response.text();
      let errorMessage = 'Failed to delete parent';
      try {
        if (errorData) {
          const errorJson = JSON.parse(errorData);
          errorMessage = errorJson.message || errorJson.error || errorMessage;
        }
      } catch {
        errorMessage = errorData || errorMessage || `HTTP ${response.status}`;
      }
      console.error(`[Parent API] Failed to delete parent:`, errorMessage);
      return NextResponse.json(
        { success: false, error: errorMessage, message: errorMessage },
        { status: response.status }
      );
    }

    const result = await response.json();
    console.log(`[Parent API] Parent deleted successfully`);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Parent API] Error deleting parent:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
