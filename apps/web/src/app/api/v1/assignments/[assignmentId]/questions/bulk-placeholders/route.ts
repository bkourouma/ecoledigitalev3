import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? process.env.API_BASE_URL || 'http://localhost:4000'
    : process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:4000';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { assignmentId } = await params;
    const body = await request.text();
    const authorization =
      request.headers.get('Authorization') ||
      ((session as any)?.jwtToken ? `Bearer ${(session as any).jwtToken}` : '');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': (session as any)?.tenantId || tenantFallback(request),
      'X-User-Id': session.user.id,
    };

    if (authorization) {
      headers.Authorization = authorization;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/v1/assignments/${assignmentId}/questions/bulk-placeholders`,
      {
        method: 'POST',
        headers,
        body,
      }
    );

    const contentType = response.headers.get('content-type') || 'application/json';
    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    console.error('POST /api/v1/assignments/[assignmentId]/questions/bulk-placeholders:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
