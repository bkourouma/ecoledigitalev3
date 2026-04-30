import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

function extractUserIdFromAuth(authHeader?: string | null): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(' ');
  const token = parts.length === 2 ? parts[1] : parts[0];
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return undefined;
    // base64url decode
    const b64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.userId || payload.sub;
  } catch {
    return undefined;
  }
}

interface Submission {
  id: string;
  assignment: {
    id: string;
    title: string;
    type: string;
  };
  course: {
    id: string;
    name: string;
    code: string;
  };
  class: {
    id: string;
    name: string;
  } | null;
  student: {
    id: string;
    number: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
  };
  file: {
    url: string;
    name: string;
    size_mb: number;
  };
  grade: {
    manual_score: number | null;
    final_score: number | null;
    feedback: string | null;
  };
  status: 'submitted' | 'graded';
  submitted_at: string;
  graded_at: string | null;
  is_late: boolean;
}

export async function GET(request: NextRequest) {
  try {
    // Extract JWT from Authorization header
    const authorization = request.headers.get('Authorization') || '';
    const tenantId = request.headers.get('X-Tenant') || 'imhotepacademy';
    const userId = request.headers.get('X-User-Id') || extractUserIdFromAuth(authorization) || '';
    const activeAcademicYearId = request.headers.get('X-Academic-Year-Id') || '';

    if (!authorization && !userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();

    console.log('🔍 TEACHER CORRECTIONS: Fetching from backend API...', {
      userId,
      queryString
    });

    // Build headers for backend request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    if (userId) headers['X-User-Id'] = userId;
    if (authorization) headers['Authorization'] = authorization;
    if (activeAcademicYearId) headers['X-Academic-Year-Id'] = activeAcademicYearId;

    // Forward the request to the backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/teacher/corrections?${queryString}`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Backend corrections API error:', response.status, data);
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch corrections' },
        { status: response.status }
      );
    }

    console.log('✅ Teacher corrections fetched successfully:', {
      submissionsCount: data.data?.submissions?.length || 0
    });

    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ TEACHER CORRECTIONS: API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
