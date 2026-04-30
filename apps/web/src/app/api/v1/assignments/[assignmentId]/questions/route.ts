import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? process.env.API_BASE_URL || 'http://localhost:4000'
    : process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:4000';

function buildProxyHeaders(request: NextRequest, session: any) {
  const authorization =
    request.headers.get('Authorization') ||
    ((session as any)?.jwtToken ? `Bearer ${(session as any).jwtToken}` : '');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant': (session as any)?.tenantId || 'imhotepacademy',
    'X-User-Id': session.user.id,
  };

  if (authorization) {
    headers.Authorization = authorization;
  }

  return headers;
}

async function proxyQuestionsRequest(
  request: NextRequest,
  assignmentId: string,
  method: 'GET' | 'POST',
  body?: string
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/assignments/${assignmentId}/questions`, {
    method,
    headers: buildProxyHeaders(request, session),
    ...(body ? { body } : {}),
  });

  const contentType = response.headers.get('content-type') || 'application/json';
  const text = await response.text();

  return new NextResponse(text, {
    status: response.status,
    headers: { 'Content-Type': contentType },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const { assignmentId } = await params;
    return await proxyQuestionsRequest(request, assignmentId, 'GET');
  } catch (error) {
    console.error('GET /api/v1/assignments/[assignmentId]/questions:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const { assignmentId } = await params;
    const body = await request.text();
    return await proxyQuestionsRequest(request, assignmentId, 'POST', body);
  } catch (error) {
    console.error('POST /api/v1/assignments/[assignmentId]/questions:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
