import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '');

type ProxySession = {
  jwtToken?: string | null;
  tenantId?: string | null;
  tenantSlug?: string | null;
  userId?: string | null;
  user?: {
    id?: string | null;
  } | null;
} | null;

function extractUserIdFromAuth(authHeader?: string | null): string | undefined {
  if (!authHeader) return undefined;

  const parts = authHeader.split(' ');
  const token = parts.length === 2 ? parts[1] : parts[0];

  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return undefined;

    const b64 = payloadPart
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json);

    return payload.userId || payload.sub;
  } catch {
    return undefined;
  }
}

function resolveProxyAuth(request: NextRequest, session: ProxySession) {
  const authorizationHeader =
    request.headers.get('authorization') ||
    (session?.jwtToken ? `Bearer ${session.jwtToken}` : null);
  const userId =
    request.headers.get('x-user-id') ||
    session?.user?.id ||
    session?.userId ||
    extractUserIdFromAuth(authorizationHeader) ||
    null;
  const tenantIdentifier =
    request.headers.get('x-tenant') ||
    session?.tenantId ||
    session?.tenantSlug ||
    'imhotepacademy';

  return { authorizationHeader, tenantIdentifier, userId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { authorizationHeader, tenantIdentifier, userId } = resolveProxyAuth(request, session);

    if (!authorizationHeader && !userId) {
      return NextResponse.json(
        { error: 'Non autorise - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const courseId = (await params).id;
    const activeAcademicYearId = request.headers.get('x-academic-year-id');
    const backendHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantIdentifier,
      ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
      ...(userId ? { 'X-User-Id': userId } : {}),
      ...(activeAcademicYearId ? { 'X-Academic-Year-Id': activeAcademicYearId } : {}),
    };

    const response = await fetch(`${API_BASE_URL}/api/v1/teacher/courses/${courseId}`, {
      method: 'GET',
      headers: backendHeaders,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Cours non trouve ou acces non autorise' },
          { status: 404 }
        );
      }

      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(errorData, { status: response.status });
    }

    const courseData = await response.json();
    return NextResponse.json(courseData);
  } catch (error) {
    console.error('Error fetching course details:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { authorizationHeader, tenantIdentifier, userId } = resolveProxyAuth(request, session);

    if (!authorizationHeader && !userId) {
      return NextResponse.json(
        { error: 'Non autorise - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const courseId = (await params).id;
    const body = await request.json();
    const activeAcademicYearId = request.headers.get('x-academic-year-id');

    const response = await fetch(`${API_BASE_URL}/api/v1/teacher/courses/${courseId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenantIdentifier,
        ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
        ...(userId ? { 'X-User-Id': userId } : {}),
        ...(activeAcademicYearId ? { 'X-Academic-Year-Id': activeAcademicYearId } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(errorData, { status: response.status });
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error updating course:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
