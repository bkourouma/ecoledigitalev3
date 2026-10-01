import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? process.env.API_BASE_URL || 'http://localhost:4000'
    : process.env.API_URL || process.env.API_BASE_URL || 'http://localhost:4000';

/**
 * Détail d'un devoir côté Next :
 * 1) Modèle d'assignment (enseignant, admin, /academic) : GET /api/v1/assignments/:id
 * 2) Sinon instance étudiant : GET /api/v1/student/assignments/:id (réponse { data }) normalisée.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { assignmentId } = await params;
    const tenantId =
      request.headers.get('X-Tenant') ||
      (session as { tenantId?: string }).tenantId ||
      tenantFallback(request);
    const authorization = request.headers.get('Authorization') || '';

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
      'X-User-Id': session.user.id,
    };
    if (authorization) {
      baseHeaders['Authorization'] = authorization;
    }

    const templateUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}`;
    const templateRes = await fetch(templateUrl, { method: 'GET', headers: baseHeaders });

    if (templateRes.ok) {
      const assignmentData = await templateRes.json();
      return NextResponse.json(assignmentData);
    }

    if (templateRes.status !== 404) {
      const errorText = await templateRes.text();
      return NextResponse.json(
        { error: 'Failed to fetch assignment', details: errorText },
        { status: templateRes.status }
      );
    }

    const studentUrl = `${API_BASE_URL}/api/v1/student/assignments/${assignmentId}`;
    const studentRes = await fetch(studentUrl, {
      method: 'GET',
      headers: baseHeaders,
    });

    if (!studentRes.ok) {
      const errorText = await studentRes.text();
      return NextResponse.json(
        { error: 'Assignment not found', details: errorText },
        { status: studentRes.status }
      );
    }

    const studentJson = await studentRes.json();
    const row = studentJson?.data;
    if (!row) {
      return NextResponse.json({ error: 'Invalid student assignment response' }, { status: 502 });
    }

    // Conserver `id` = instance (soumissions / URLs étudiant) ; ajouter champs plats pour les écrans qui attendent le modèle « assignment ».
    return NextResponse.json({
      ...row,
      ends_at: row.due_date,
      course_title: row.course?.name,
      course_code: row.course?.code,
      course_id: row.course?.id,
      type: row.submission_type === 'homework' ? 'homework' : 'evaluation',
    });
  } catch (error) {
    console.error('GET /api/v1/assignments/[assignmentId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { assignmentId } = await params;
    const tenantId =
      request.headers.get('X-Tenant') ||
      (session as { tenantId?: string }).tenantId ||
      tenantFallback(request);
    const authorization =
      request.headers.get('Authorization') ||
      ((session as any)?.jwtToken ? `Bearer ${(session as any).jwtToken}` : '');

    const headers: Record<string, string> = {
      'X-Tenant': tenantId,
      'X-User-Id': session.user.id,
    };

    if (authorization) {
      headers.Authorization = authorization;
    }

    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}`;
    const response = await fetch(backendUrl, {
      method: 'DELETE',
      headers,
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const text = await response.text();

    if (!response.ok) {
      return new NextResponse(text || JSON.stringify({ error: 'Failed to delete assignment' }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' },
    });
  } catch (error) {
    console.error('DELETE /api/v1/assignments/[assignmentId]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
