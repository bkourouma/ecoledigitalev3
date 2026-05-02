import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

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

export async function POST(request: NextRequest) {
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

    const body = await request.json();

    const response = await fetch(`${API_BASE_URL}/api/v1/teacher/attendance/submit`, {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "Authorization": authorizationHeader,
        "X-Tenant": tenantIdentifier,
        "X-User-Id": userId,
        ...(activeAcademicYearId ? { "X-Academic-Year-Id": activeAcademicYearId } : {})
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Backend error response:', errorData);
      return NextResponse.json({
        ...errorData,
        message: errorData.message || `HTTP ${response.status}: ${response.statusText}`
      }, { status: response.status });
    }

    const result = await response.json();
    return NextResponse.json(result, { status: 200 });

  } catch (error) {
    console.error('Error submitting hours:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'Erreur interne du serveur',
        message: errorMessage,
        ...(process.env.NODE_ENV === 'development' && {
          stack: error instanceof Error ? error.stack : undefined
        })
      },
      { status: 500 }
    );
  }
}
