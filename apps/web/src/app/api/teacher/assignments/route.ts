import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = "";

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user session
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: 'Non autorisé - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const teacherId = (session as any).user?.id;
    if (!teacherId) {
      return NextResponse.json(
        { error: 'ID utilisateur manquant' },
        { status: 401 }
      );
    }

    // Get query parameters from the request
    const url = new URL(request.url);
    const searchParams = url.searchParams.toString();
    const queryString = searchParams ? `?${searchParams}` : '';

    // Forward the request to the backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/teacher-assignments${queryString}`, {
      method: 'GET',
      headers: {
      "Content-Type": "application/json",
      "X-Tenant": (session as any)?.tenantId || tenantFallback(request),
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    }
    });

    if (!response.ok) {
      throw new Error(`Backend API error: ${response.status}`);
    }

    const assignments = await response.json();
    return NextResponse.json(assignments);

  } catch (error) {
    console.error('Error fetching teacher assignments:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
