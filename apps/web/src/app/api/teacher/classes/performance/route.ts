import { NextRequest, NextResponse } from 'next/server';
import { tenantFallback } from '@/platform/tenant/server';

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
    const b64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.userId || payload.sub;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get('Authorization') || '';
    const tenantId = request.headers.get('X-Tenant') || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || extractUserIdFromAuth(authorization) || '';
    const activeAcademicYearId = request.headers.get('X-Academic-Year-Id') || '';

    if (!authorization && !userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    if (userId) headers['X-User-Id'] = userId;
    if (authorization) headers['Authorization'] = authorization;
    if (activeAcademicYearId) headers['X-Academic-Year-Id'] = activeAcademicYearId;

    const response = await fetch(`${API_BASE_URL}/api/v1/teacher/students/classes/performance`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Backend class performance API error:', response.status, data);
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch class performance' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ TEACHER CLASSES PERFORMANCE: API error:', error);
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

