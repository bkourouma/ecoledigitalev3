import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '');

function resolveProxyAuth(request: NextRequest, session: any) {
  const userId =
    request.headers.get("x-user-id") ||
    session?.user?.id ||
    null;
  const tenantIdentifier =
    request.headers.get("x-tenant") ||
    session?.tenantId ||
    session?.tenantSlug ||
    "imhotepacademy";
  const authorizationHeader =
    request.headers.get("authorization") ||
    (session?.jwtToken ? `Bearer ${session.jwtToken}` : null);

  return { userId, tenantIdentifier, authorizationHeader };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { userId, tenantIdentifier, authorizationHeader } = resolveProxyAuth(request, session);
    const activeAcademicYearId = request.headers.get("x-academic-year-id");

    if (!userId || !authorizationHeader) {
      return NextResponse.json(
        { error: 'Non autorise - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const isUuid = /^[0-9a-fA-F-]{36}$/.test(String(userId));
    if (!isUuid) {
      return NextResponse.json(
        { error: 'Session invalide', message: 'Votre session utilise un ancien identifiant. Veuillez vous deconnecter puis vous reconnecter.' },
        { status: 401 }
      );
    }

    const resolvedParams = await params;
    const assignmentId = resolvedParams.id;

    const backendHeaders: Record<string, string> = {
      'Authorization': authorizationHeader,
      'X-Tenant': tenantIdentifier,
      'X-User-Id': userId,
      ...(activeAcademicYearId ? { 'X-Academic-Year-Id': activeAcademicYearId } : {}),
    };

    const response = await fetch(`${API_BASE_URL}/api/v1/teacher/attendance/${assignmentId}`, {
      method: 'GET',
      headers: backendHeaders,
      cache: 'no-store',
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const errorBody = contentType.includes('application/json') ? await response.json() : await response.text();
      console.error('Proxy teacher attendance failed', {
        status: response.status,
        assignmentId,
        errorBody
      });
      return NextResponse.json(
        { error: 'Backend error', status: response.status, details: errorBody },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching attendance history:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
