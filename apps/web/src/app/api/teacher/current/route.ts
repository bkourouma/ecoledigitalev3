import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

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

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const { authorizationHeader, tenantIdentifier, userId } = resolveProxyAuth(request, session);

    if (!authorizationHeader && !userId) {
      return NextResponse.json(
        { error: 'Non autorise - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const backendHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantIdentifier,
      ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
      ...(userId ? { 'X-User-Id': userId } : {}),
    };

    const response = await fetch(`${API_BASE_URL}/api/v1/teachers`, {
      method: 'GET',
      headers: backendHeaders,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error('Failed to fetch teachers:', { status: response.status, errorBody });
      return NextResponse.json(
        { error: 'Erreur lors de la recuperation des enseignants', details: errorBody },
        { status: response.status }
      );
    }

    const data = await response.json();
    const teacher = data.data?.find((t: { userId?: string | null }) => t.userId === userId);

    if (!teacher) {
      return NextResponse.json(
        { error: 'Enseignant non trouve', message: 'Aucun profil enseignant trouve pour cet utilisateur' },
        { status: 404 }
      );
    }

    return NextResponse.json(teacher);
  } catch (error) {
    console.error('Error fetching current teacher:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
