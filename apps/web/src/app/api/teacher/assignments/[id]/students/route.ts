import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 
  (process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get the authenticated user session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Non autorisé - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    
    // Validate userId is a UUID (to avoid legacy demo IDs)
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(String(userId));
    if (!isUuid) {
      return NextResponse.json(
        { error: 'Session invalide', message: 'Votre session utilise un ancien identifiant. Veuillez vous déconnecter puis vous reconnecter.' },
        { status: 401 }
      );
    }

    const assignmentId = (await params).id;

    // Prefer tenant_id (UUID) over tenantSlug for better backend resolution
    const tenantIdentifier = (session as any)?.tenantId || (session as any)?.tenantSlug || 'imhotepacademy';

    // Forward the request to the backend API
    const backendHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantIdentifier,
    };
    
    // Add JWT token if available
    if ((session as any)?.jwtToken) {
      backendHeaders['Authorization'] = `Bearer ${(session as any).jwtToken}`;
    }
    
    // Add user ID header (required for teacher routes)
    if (userId) {
      backendHeaders['X-User-Id'] = userId;
    }

    console.log('📤 Fetching students for assignment:', {
      assignmentId,
      'X-Tenant': tenantIdentifier,
      'X-User-Id': userId,
      hasJWT: !!(session as any)?.jwtToken
    });

    // Note: The backend endpoint is /api/v1/teacher-assignments/:id/students (not /api/v1/teacher/assignments)
    const response = await fetch(`${API_BASE_URL}/api/v1/teacher-assignments/${assignmentId}/students`, {
      method: 'GET',
      headers: backendHeaders
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const errorBody = contentType.includes('application/json') ? await response.json() : await response.text();
      console.error('Proxy teacher-assignments students failed', { 
        status: response.status, 
        assignmentId,
        errorBody 
      });
      return NextResponse.json(
        { error: 'Backend error', status: response.status, details: errorBody },
        { status: response.status }
      );
    }

    const students = await response.json();
    return NextResponse.json(students);

  } catch (error) {
    console.error('Error fetching assignment students:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
