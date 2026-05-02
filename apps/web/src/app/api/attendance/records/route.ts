import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    const url = new URL(request.url);
    const search = url.searchParams.toString();

    const tenantSlug = (session as any).tenantSlug || 'imhotepacademy';
    const teacherUserId = (session as any).user?.id as string;
    const jwtToken = (session as any).jwtToken;

    if (!jwtToken) {
      return NextResponse.json(
        { error: "Token d'authentification manquant" },
        { status: 401 }
      );
    }

    // Get tenant ID from session (prefer tenantId over tenantSlug)
    const tenantId = (session as any).tenantId || tenantSlug;

    const backendUrl = `${API_BASE_URL}/api/v1/attendance/records${search ? `?${search}` : ''}`;

    const resp = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwtToken}`,
        "X-Tenant": tenantId,
        "X-User-Id": teacherUserId
      },
      cache: 'no-store',
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return NextResponse.json(err || { error: 'Erreur backend' }, { status: resp.status });
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error('Error proxying attendance records:', e);
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 });
  }
}

