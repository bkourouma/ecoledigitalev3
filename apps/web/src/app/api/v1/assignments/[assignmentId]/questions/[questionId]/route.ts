import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string; questionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const { assignmentId, questionId } = await params;
    const body = await request.text();
    const authorization =
      request.headers.get('Authorization') ||
      ((session as any)?.jwtToken ? `Bearer ${(session as any).jwtToken}` : '');

    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}/questions/${questionId}`;

    const headers: Record<string, string> = {
      'X-Tenant': (session as any)?.tenantId || tenantFallback(request),
      'X-User-Id': session.user.id,
      'Content-Type': 'application/json',
    };

    if (authorization) {
      headers.Authorization = authorization;
    }

    const response = await fetch(backendUrl, {
      method: 'PUT',
      headers,
      body,
    });

    const data = await response.text();
    return new NextResponse(data, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Erreur interne du serveur' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string; questionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const { assignmentId, questionId } = await params;
    const authorization =
      request.headers.get('Authorization') ||
      ((session as any)?.jwtToken ? `Bearer ${(session as any).jwtToken}` : '');

    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}/questions/${questionId}`;

    const headers: Record<string, string> = {
      'X-Tenant': (session as any)?.tenantId || tenantFallback(request),
      'X-User-Id': session.user.id,
    };

    if (authorization) {
      headers.Authorization = authorization;
    }

    const response = await fetch(backendUrl, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      return new NextResponse(text || JSON.stringify({ success: false }), { status: response.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Erreur interne du serveur' }, { status: 500 });
  }
}














