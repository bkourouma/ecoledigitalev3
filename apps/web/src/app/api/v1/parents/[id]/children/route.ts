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
    const { id: parentId } = await params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const authorization = request.headers.get('Authorization');
    const tenant = request.headers.get('X-Tenant') || session.tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || session.user.id;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Tenant': tenant,
      'X-User-Id': userId,
    };

    if (authorization) {
      headers['Authorization'] = authorization;
    }

    // Query children directly from the backend API
    const childrenResponse = await fetch(`${API_BASE_URL}/api/v1/parents/${parentId}/children`, {
      method: 'GET',
      headers,
    });

    if (!childrenResponse.ok) {
      const errorData = await childrenResponse.text();
      console.error('[Parent Children API] Error fetching children:', errorData);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch children' },
        { status: childrenResponse.status }
      );
    }

    const childrenData = await childrenResponse.json();
    return NextResponse.json(childrenData);
  } catch (error: any) {
    console.error('[Parent Children API] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
