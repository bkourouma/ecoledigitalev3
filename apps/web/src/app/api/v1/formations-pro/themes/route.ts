import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || 'imhotepdata';
    const userId = request.headers.get('X-User-Id') || session?.user?.id;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    
    if (userId) headers['X-User-Id'] = userId;
    
    // Note: Authorization header is NOT required for public catalog routes
    // The backend auth middleware will skip authentication for /api/v1/formations-pro
    
    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/themes`;
    
    console.log('🔍 FORMATIONS-PRO THEMES API: Fetching themes:', {
      tenantId,
      userId: userId || 'none (public)',
      url: backendUrl
    });
    
    try {
      const response = await fetch(backendUrl, { method: 'GET', headers });
      
      console.log('📊 FORMATIONS-PRO THEMES API: Backend response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        
        console.error('❌ FORMATIONS-PRO THEMES API: Backend error:', {
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
      console.log('✅ FORMATIONS-PRO THEMES API: Success, themes count:', data?.data?.themes?.length || 0);
      
      return NextResponse.json(data);
    } catch (fetchError: any) {
      console.error('❌ FORMATIONS-PRO THEMES API: Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to connect to backend API', details: fetchError.message },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('❌ FORMATIONS-PRO THEMES API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

