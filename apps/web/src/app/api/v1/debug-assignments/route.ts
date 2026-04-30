import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET(request: NextRequest) {
  console.log('🔍 Debug assignments route - GET request received');
  
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Authentication required'
      }, { status: 401 });
    }

    // Get tenant ID
    const incomingTenant = request.headers.get('X-Tenant') || request.headers.get('x-tenant');
    const tenantId = session.tenantId || incomingTenant || 'imhotepacademy';
    
    console.log('🔍 Debug assignments - tenant:', tenantId);

    // Try to fetch assignments from backend
    const backendUrl = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:4000' 
      : process.env.API_URL || 'http://localhost:4000';

    try {
      const response = await fetch(`${backendUrl}/api/v1/assignments?limit=10`, {
        method: 'GET',
        headers: {
          'X-Tenant': tenantId,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          message: 'Assignments fetched from backend',
          backend_available: true,
          tenant_id: tenantId,
          user_id: session.user.id,
          assignments: data.data || data,
          count: Array.isArray(data.data) ? data.data.length : Array.isArray(data) ? data.length : 0
        });
      } else {
        const errorText = await response.text();
        return NextResponse.json({
          success: false,
          message: 'Backend responded with error',
          backend_available: true,
          backend_error: {
            status: response.status,
            statusText: response.statusText,
            body: errorText
          },
          tenant_id: tenantId,
          user_id: session.user.id
        });
      }
    } catch (backendError) {
      // Backend not available, return mock data
      return NextResponse.json({
        success: true,
        message: 'Backend not available, returning mock data',
        backend_available: false,
        backend_error: backendError instanceof Error ? backendError.message : 'Unknown error',
        tenant_id: tenantId,
        user_id: session.user.id,
        mock_assignments: [
          {
            id: '0efa3603-6cdf-4002-8d97-61392135970a',
            title: 'Test Assignment 1',
            type: 'homework',
            status: 'published'
          },
          {
            id: '44d4eb08-e62e-43c8-a9bb-40a7ade39ce9',
            title: 'Test Assignment 2 (URL ID)',
            type: 'evaluation',
            status: 'published'
          }
        ],
        note: 'These are mock assignments for testing. Real assignments would come from the backend.'
      });
    }
  } catch (error) {
    console.error('❌ Debug assignments error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
