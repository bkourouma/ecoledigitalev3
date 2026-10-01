import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;
    
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || session?.user?.id;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    
    if (userId) headers['X-User-Id'] = userId;
    
    const authorization = request.headers.get('Authorization');
    if (authorization) headers['Authorization'] = authorization;
    
    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${id}/similaires`;
    
    const response = await fetch(backendUrl, { method: 'GET', headers });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      return NextResponse.json(errorData, { status: response.status });
    }
    
    return NextResponse.json(await response.json());
  } catch (error) {
    console.error('❌ FORMATIONS-PRO SIMILAIRES API: Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

