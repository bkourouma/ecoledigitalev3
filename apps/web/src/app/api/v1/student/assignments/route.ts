import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

/** Urgence dérivée de l'échéance, même règle que la route académique. */
function priorityOf(dueAt: string | null, rendu: boolean): 'low' | 'medium' | 'high' {
  // Une copie deja rendue, ou une echeance passee, n'a plus rien d'urgent :
  // sans ce garde-fou tout un historique de devoirs s'affiche en « Urgent ».
  if (!dueAt || rendu) return 'low';
  const reste = new Date(dueAt).getTime() - Date.now();
  if (reste < 0) return 'low';
  if (reste < 24 * 3600_000) return 'high';
  if (reste < 3 * 24 * 3600_000) return 'medium';
  return 'low';
}

/**
 * Devoirs du Module Professionnel, ramenés au format de la liste académique.
 * Un échec est silencieux : la page doit continuer à afficher les devoirs
 * académiques même si le module professionnel ne répond pas.
 */
async function fetchProfessionalAssignments(headers: HeadersInit): Promise<any[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/professional/student/assignments`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) return [];
    const json = await res.json();
    const rows = json?.data ?? json;
    if (!Array.isArray(rows)) return [];

    return rows.map((a: any) => ({
      id: a.id,
      assignment_id: a.id,
      // Repère de provenance : la fiche de détail n'existe que côté académique.
      source: 'professionnel',
      title: a.titre,
      description: a.description ?? '',
      course: { id: a.ecue_id, name: a.ecue_libelle, code: a.ecue_code },
      instructor: null,
      due_date: a.due_at,
      submitted_at: a.submitted_at ?? null,
      status:
        a.submission_statut === 'note'
          ? 'graded'
          : a.submission_statut
            ? 'submitted'
            : a.due_at && new Date(a.due_at) < new Date()
              ? 'expired'
              : 'pending',
      priority: priorityOf(a.due_at ?? null, Boolean(a.submitted_at)),
      max_points: Number(a.note_max ?? 20),
      grade: a.note != null ? Number(a.note) : null,
      submission_type: a.evaluation_type === 'online' ? 'evaluation' : 'homework',
      feedback: a.appreciation ?? null,
      subject_document_url: a.subject_document_url ?? null,
      subject_document_name: a.subject_document_url
        ? String(a.subject_document_url).split('/').pop() || null
        : null,
      subject_content: a.subject_content ?? null,
    }));
  } catch (error) {
    console.error('❌ STUDENT ASSIGNMENTS API: module professionnel indisponible', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get session for authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Aligner le tenant sur la session si l’en-tête client est absent (ex. ancien client / dev)
    const sessionAny = session as { tenantSlug?: string; tenantId?: string };
    const tenantId =
      request.headers.get('X-Tenant') ||
      sessionAny.tenantSlug ||
      sessionAny.tenantId ||
      tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || session.user.id;
    const authorization = request.headers.get('Authorization');
    const activeAcademicYearId = request.headers.get('X-Academic-Year-Id');

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();

    console.log('🔍 STUDENT ASSIGNMENTS API: Fetching student assignments', {
      tenantId,
      userId,
      queryParams: queryString,
      hasAuthHeader: !!authorization
    });

    // Forward the request to the backend API
    const url = `${API_BASE_URL}/api/v1/student/assignments${queryString ? `?${queryString}` : ''}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
      'X-User-Id': userId,
    };
    
    // Forward Authorization header if present
    if (authorization) {
      headers['Authorization'] = authorization;
    }
    if (activeAcademicYearId) {
      headers['X-Academic-Year-Id'] = activeAcademicYearId;
    }
    
    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    console.log('📊 STUDENT ASSIGNMENTS API: Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ STUDENT ASSIGNMENTS API: Backend error:', response.status, errorText);
      
      if (response.status === 404) {
        return NextResponse.json(
          { success: false, error: 'Assignments not found', data: [] },
          { status: 200 } // Return 200 with empty array to prevent frontend errors
        );
      }
      
      return NextResponse.json(
        { success: false, error: 'Failed to fetch assignments', data: [] },
        { status: 200 } // Return 200 with empty array to prevent frontend errors
      );
    }

    const data = await response.json();
    console.log('✅ STUDENT ASSIGNMENTS API: Assignments fetched successfully');

    // Les devoirs du Module Professionnel vivent dans d'autres tables
    // (`professional_assignments`) et ne sont donc pas remontés par la route
    // académique ci-dessus. Un étudiant du module professionnel voyait une page
    // vide alors que ses copies étaient bien déposées et notées. On complète
    // ici la liste, comme le font déjà « Mes Cours » et « Bulletins & Reçus ».
    const professionnels = await fetchProfessionalAssignments(headers);
    const merged = [...(Array.isArray(data?.data) ? data.data : []), ...professionnels].sort(
      (a, b) => new Date(b.due_date ?? 0).getTime() - new Date(a.due_date ?? 0).getTime()
    );

    return NextResponse.json({
      ...data,
      success: true,
      data: merged,
      pagination: { ...(data?.pagination ?? {}), total: merged.length },
    });

  } catch (error) {
    console.error('❌ STUDENT ASSIGNMENTS API: Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', data: [] },
      { status: 200 } // Return 200 with empty array to prevent frontend errors
    );
  }
}



