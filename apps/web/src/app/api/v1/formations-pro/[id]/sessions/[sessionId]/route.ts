import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id, sessionId } = await params;
    
    const body = await request.json();
    
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || session?.user?.id;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    
    if (userId) headers['X-User-Id'] = userId;
    
    const authorization = request.headers.get('Authorization');
    if (authorization) headers['Authorization'] = authorization;
    
    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${id}/sessions/${sessionId}`;
    
    console.log('🔍 FORMATIONS-PRO SESSIONS API: Updating session:', {
      formationId: id,
      sessionId,
      tenantId,
      userId: userId || 'none',
      url: backendUrl
    });
    
    const response = await fetch(backendUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    
    console.log('📊 FORMATIONS-PRO SESSIONS API: Backend response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText || `HTTP ${response.status}` };
      }
      
      console.error('❌ FORMATIONS-PRO SESSIONS API: Backend error:', {
        status: response.status,
        error: errorData,
        errorText
      });
      
      return NextResponse.json(
        { error: errorData.error || errorData.message || `HTTP ${response.status}` },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    console.log('✅ FORMATIONS-PRO SESSIONS API: Session updated successfully');
    return NextResponse.json(data);
  } catch (error) {
    console.error('❌ FORMATIONS-PRO SESSIONS API: Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sessionId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id, sessionId } = await params;
    
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || session?.user?.id;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    
    if (userId) headers['X-User-Id'] = userId;
    
    const authorization = request.headers.get('Authorization');
    if (authorization) headers['Authorization'] = authorization;
    
    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${id}/sessions/${sessionId}`;
    
    console.log('🔍 FORMATIONS-PRO SESSIONS API: Deleting session:', {
      formationId: id,
      sessionId,
      tenantId,
      userId: userId || 'none',
      url: backendUrl
    });
    
    const response = await fetch(backendUrl, {
      method: 'DELETE',
      headers,
    });
    
    console.log('📊 FORMATIONS-PRO SESSIONS API: Backend response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText || `HTTP ${response.status}` };
      }
      
      console.error('❌ FORMATIONS-PRO SESSIONS API: Backend error:', {
        status: response.status,
        error: errorData,
        errorText
      });
      
      return NextResponse.json(
        { error: errorData.error || errorData.message || `HTTP ${response.status}` },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    console.log('✅ FORMATIONS-PRO SESSIONS API: Session deleted successfully');
    return NextResponse.json(data);
  } catch (error) {
    console.error('❌ FORMATIONS-PRO SESSIONS API: Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

