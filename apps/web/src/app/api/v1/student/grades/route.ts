import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get Authorization header from request (added by fetch interceptor)
    const authorization = request.headers.get('Authorization');
    const activeAcademicYearId = request.headers.get('X-Academic-Year-Id');
    
    console.log('📊 STUDENT GRADES API: Request details:', {
      userId: session.user.id,
      tenantId: session.tenantId || 'imhotepacademy',
      hasAuthHeader: !!authorization
    });

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    
    // Forward the request to the backend API
    const backendUrl = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:4000' 
      : process.env.API_URL || 'http://localhost:4000';

    // Build headers for backend request
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-Tenant': session.tenantId || 'imhotepacademy',
      'X-User-Id': session.user.id,
    };

    // Forward Authorization header if present (JWT token)
    if (authorization) {
      headers['Authorization'] = authorization;
      console.log('✅ JWT token forwarded to backend');
    } else {
      console.warn('⚠️  No Authorization header found - backend may reject request');
    }
    if (activeAcademicYearId) {
      headers['X-Academic-Year-Id'] = activeAcademicYearId;
    }

    const response = await fetch(`${backendUrl}/api/v1/student/grades?${queryString}`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    console.log('📊 STUDENT GRADES API: Backend response:', {
      status: response.status,
      ok: response.ok,
      success: data.success,
      hasData: !!data.data,
      gradesCount: data.data?.grades?.length || data.data?.length || 0
    });

    if (!response.ok) {
      console.error('❌ Backend error:', data);
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch grades' },
        { status: response.status }
      );
    }

    // Transform backend response to match frontend expectations
    // Backend returns { success: true, data: { grades: [...], stats: {...} }, pagination: {...} }
    // Frontend expects { success: true, data: [...], statistics: {...} }
    if (data.success && data.data) {
      const transformedData = {
        success: true,
        data: data.data.grades || data.data || [],
        statistics: data.data.stats ? {
          average: data.data.stats.average_score || 0,
          total_points: data.data.stats.total_points || 0,
          max_total_points: data.data.stats.max_total_points || 0,
          best_score: data.data.stats.best_score || 0,
          grade_distribution: {
            excellent: 0,
            good: 0,
            average: 0,
            below_average: 0
          }
        } : {
          average: 0,
          total_points: 0,
          max_total_points: 0,
          best_score: 0,
          grade_distribution: {
            excellent: 0,
            good: 0,
            average: 0,
            below_average: 0
          }
        }
      };

      // Calculate grade distribution from grades
      if (transformedData.data.length > 0) {
        transformedData.statistics.grade_distribution = {
          excellent: transformedData.data.filter((g: any) => g.grade >= 16).length,
          good: transformedData.data.filter((g: any) => g.grade >= 14 && g.grade < 16).length,
          average: transformedData.data.filter((g: any) => g.grade >= 12 && g.grade < 14).length,
          below_average: transformedData.data.filter((g: any) => g.grade < 12).length
        };
      }

      console.log('✅ Transformed data:', {
        gradesCount: transformedData.data.length,
        average: transformedData.statistics.average
      });

      return NextResponse.json(transformedData);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('❌ Error fetching student grades:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}