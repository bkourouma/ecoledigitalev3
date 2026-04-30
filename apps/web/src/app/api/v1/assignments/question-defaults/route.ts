import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? process.env.API_BASE_URL || 'http://localhost:4000'
    : process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:4000';

function buildHeaders(request: NextRequest, session: any) {
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

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/assignments/question-defaults`, {
      method: 'GET',
      headers: buildHeaders(request, session),
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    console.error('GET /api/v1/assignments/question-defaults:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur interne du serveur' },
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

    const body = await request.text();
    const response = await fetch(`${API_BASE_URL}/api/v1/assignments/question-defaults`, {
      method: 'POST',
      headers: buildHeaders(request, session),
      body,
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    const text = await response.text();

    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    console.error('POST /api/v1/assignments/question-defaults:', error);
    return NextResponse.json(
      { success: false, error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
