import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

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

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const { userId, tenantIdentifier, authorizationHeader } = resolveProxyAuth(request, session);
    const activeAcademicYearId = request.headers.get("x-academic-year-id");

    if (!authorizationHeader) {
      return NextResponse.json(
        { error: 'Non autorise - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const searchParams = new URLSearchParams();

    const fromDate = url.searchParams.get('fromDate');
    const toDate = url.searchParams.get('toDate');
    const teacherId = url.searchParams.get('teacherId');
    const assignmentId = url.searchParams.get('assignmentId');

    if (fromDate) searchParams.set('fromDate', fromDate);
    if (toDate) searchParams.set('toDate', toDate);
    if (teacherId) searchParams.set('teacherId', teacherId);
    if (assignmentId) searchParams.set('assignmentId', assignmentId);

    const queryString = searchParams.toString();

    const backendHeaders: Record<string, string> = {
      "Authorization": authorizationHeader,
      "X-Tenant": tenantIdentifier,
      ...(activeAcademicYearId ? { "X-Academic-Year-Id": activeAcademicYearId } : {}),
    };

    if (userId) {
      backendHeaders["X-User-Id"] = userId;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/teacher/attendance${queryString ? `?${queryString}` : ''}`, {
      method: 'GET',
      headers: backendHeaders,
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(errorData, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Error fetching teacher attendance sessions:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
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

    const response = await fetch(`${API_BASE_URL}/api/v1/teacher/attendance`, {
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
      const errorData = await response.json();
      return NextResponse.json(errorData, { status: response.status });
    }

    const result = await response.json();
    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    console.error('Error saving attendance:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
