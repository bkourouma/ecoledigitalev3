import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

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
      'imhotepacademy';
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
    
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ STUDENT ASSIGNMENTS API: Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', data: [] },
      { status: 200 } // Return 200 with empty array to prevent frontend errors
    );
  }
}



