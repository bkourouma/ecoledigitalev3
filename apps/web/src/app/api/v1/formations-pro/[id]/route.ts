import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

// Log when the module is loaded
console.log('📦 FORMATIONS-PRO API [id] route.ts: Module loaded');

// Helper function to check if a string is a UUID
function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  console.log('🚀 FORMATIONS-PRO API [id] route.ts: GET handler called');
  try {
    // Get session for authentication (optional for public catalog)
    const session = await getServerSession(authOptions);
    console.log('🔐 FORMATIONS-PRO API: Session retrieved:', !!session);
    
    const { id } = await params;
    console.log('📋 FORMATIONS-PRO API: Params id:', id);
    
    // Next.js params are already decoded, but ensure it's properly handled
    // The slug should be used as-is for the backend API
    const slug = id;
    
    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || (session?.user as any)?.id;
    
    // Build headers for backend request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    
    // Add X-User-Id if available
    if (userId) {
      headers['X-User-Id'] = userId;
    }
    
    // Forward Authorization header if present (JWT token)
    const authorization = request.headers.get('Authorization');
    if (authorization) {
      headers['Authorization'] = authorization;
    }
    
    // Determine if id is a UUID or a slug
    // If it's a UUID, we need to get the formation by ID (which requires a different approach)
    // If it's a slug, we can use the slug endpoint
    // For now, we'll always use it as a slug since the backend API uses slug for detail endpoint
    // Properly encode the slug for the URL path (encodeURIComponent handles special characters but keeps valid URL chars)
    // We need to encode each segment separately to preserve slashes if any
    const encodedSlug = slug.split('/').map((segment: string) => encodeURIComponent(segment)).join('/');
    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${encodedSlug}`;
    
    console.log('🔍 FORMATIONS-PRO API: Fetching formation detail:', {
      id,
      slug,
      encodedSlug,
      isUUID: isUUID(id),
      tenantId,
      userId,
      url: backendUrl
    });
    
    try {
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers,
      });

      console.log('📊 FORMATIONS-PRO API: Backend response status:', response.status);
      console.log('📊 FORMATIONS-PRO API: Backend response headers:', Object.fromEntries(response.headers.entries()));
      console.log('📊 FORMATIONS-PRO API: Backend response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        
        console.error('❌ FORMATIONS-PRO API: Backend error:', {
          status: response.status,
          error: errorData,
          errorText
        });
        
        return NextResponse.json(
          { error: errorData.error || errorData.message || `HTTP ${response.status}` },
          { status: response.status }
        );
      }

      // Parse JSON response (same approach as the list route)
      // First, read as text to see what we're getting
      const responseText = await response.text();
      console.log('📝 FORMATIONS-PRO API: Backend response text length:', responseText.length);
      console.log('📝 FORMATIONS-PRO API: Backend response text (first 500 chars):', responseText.substring(0, 500));
      
      let data;
      try {
        data = JSON.parse(responseText);
        console.log('✅ FORMATIONS-PRO API: Backend response parsed successfully:', {
          hasSuccess: 'success' in data,
          hasData: 'data' in data,
          success: data.success,
          dataKeys: data.data ? Object.keys(data.data) : [],
          dataTitre: data.data?.titre,
          dataStringifiedLength: JSON.stringify(data).length,
        });
      } catch (parseError: any) {
        console.error('❌ FORMATIONS-PRO API: Failed to parse JSON response:', parseError);
        // Try to read as text for debugging
        try {
          const responseClone = response.clone();
          const text = await responseClone.text();
          console.error('❌ FORMATIONS-PRO API: Response text:', text.substring(0, 500));
        } catch (cloneError) {
          console.error('❌ FORMATIONS-PRO API: Could not clone response');
        }
        return NextResponse.json(
          {
            success: false,
            error: "PARSE_ERROR",
            message: "Failed to parse backend response",
          },
          { status: 500 }
        );
      }

      // Check if the response is empty or indicates not found
      console.log('🔍 FORMATIONS-PRO API: Checking response validity:', {
        hasData: !!data,
        dataKeys: data ? Object.keys(data) : [],
        dataLength: data ? Object.keys(data).length : 0,
        success: data?.success,
        error: data?.error,
        dataStringified: JSON.stringify(data),
        isEmpty: !data || Object.keys(data).length === 0,
        isNotFound: data?.success === false && data?.error === "NOT_FOUND",
      });
      
      // Vérifier si data est vide ou si c'est une réponse d'erreur
      const isEmpty = !data || Object.keys(data).length === 0;
      const isNotFound = data?.success === false && data?.error === "NOT_FOUND";
      const hasEmptyData = data?.success === true && (!data.data || Object.keys(data.data || {}).length === 0);
      
      // Si le backend retourne un objet vide {}, c'est probablement une erreur de sérialisation
      if (isEmpty) {
        console.error('❌ FORMATIONS-PRO API: Backend returned empty object - possible serialization error', {
          responseText: responseText.substring(0, 200),
          backendUrl,
        });
        return NextResponse.json(
          {
            success: false,
            error: "SERIALIZATION_ERROR",
            message: "Backend returned empty response - possible data serialization issue",
          },
          { status: 500 }
        );
      }
      
      if (isNotFound || hasEmptyData) {
        console.warn('⚠️ FORMATIONS-PRO API: Formation not found or empty data', {
          isEmpty,
          isNotFound,
          hasEmptyData,
          data,
        });
        return NextResponse.json(
          {
            success: false,
            error: "NOT_FOUND",
            message: "Training program not found or inactive",
          },
          { status: 404 }
        );
      }

      // Check if response has the expected structure
      if (!data.success || !data.data) {
        console.warn('⚠️ FORMATIONS-PRO API: Invalid response structure:', data);
        return NextResponse.json(
          {
            success: false,
            error: "INVALID_RESPONSE",
            message: "Invalid response from backend",
          },
          { status: 500 }
        );
      }

      console.log('✅ FORMATIONS-PRO API: Success, formation:', data.data.titre);
      console.log('📤 FORMATIONS-PRO API: Returning response with data:', {
        success: data.success,
        hasData: !!data.data,
        dataTitre: data.data?.titre,
        responseKeys: Object.keys(data),
      });
      const nextResponse = NextResponse.json(data);
      console.log('📤 FORMATIONS-PRO API: Response created, status:', nextResponse.status);
      return nextResponse;
    } catch (fetchError: any) {
      console.error('❌ FORMATIONS-PRO API: Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to connect to backend API', details: fetchError.message },
        { status: 503 }
      );
    }
  } catch (error: any) {
    console.error('❌ FORMATIONS-PRO API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  console.log('🚀 FORMATIONS-PRO API [id] route.ts: PUT handler called');
  try {
    // Get session for authentication
    const session = await getServerSession(authOptions);
    console.log('🔐 FORMATIONS-PRO API: Session retrieved:', !!session);
    
    const { id } = await params;
    console.log('📋 FORMATIONS-PRO API: Params id:', id);
    
    // The slug should be used as-is for the backend API
    const slug = id;
    
    // Get body from the request
    const body = await request.json();
    
    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || (session?.user as any)?.id;
    
    // Build headers for backend request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    
    // Add X-User-Id if available
    if (userId) {
      headers['X-User-Id'] = userId;
    }
    
    // Forward Authorization header if present (JWT token)
    const authorization = request.headers.get('Authorization');
    if (authorization) {
      headers['Authorization'] = authorization;
    }
    
    // Encode the slug for the URL path
    const encodedSlug = slug.split('/').map((segment: string) => encodeURIComponent(segment)).join('/');
    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${encodedSlug}`;
    
    console.log('🔍 FORMATIONS-PRO API: Updating formation:', {
      id,
      slug,
      encodedSlug,
      tenantId,
      userId,
      url: backendUrl
    });
    
    try {
      const response = await fetch(backendUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });

      console.log('📊 FORMATIONS-PRO API: Backend response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        
        console.error('❌ FORMATIONS-PRO API: Backend error:', {
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
      console.log('✅ FORMATIONS-PRO API: Formation updated successfully');
      return NextResponse.json(data);
    } catch (fetchError: any) {
      console.error('❌ FORMATIONS-PRO API: Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to connect to backend API', details: fetchError.message },
        { status: 503 }
      );
    }
  } catch (error: any) {
    console.error('❌ FORMATIONS-PRO API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  console.log('🚀 FORMATIONS-PRO API [id] route.ts: DELETE handler called');
  try {
    // Get session for authentication
    const session = await getServerSession(authOptions);
    console.log('🔐 FORMATIONS-PRO API: Session retrieved:', !!session);
    
    const { id } = await params;
    console.log('📋 FORMATIONS-PRO API: Params id:', id);
    
    // Get headers for backend request
    const tenantId = request.headers.get('X-Tenant') || (session as any)?.tenantId || tenantFallback(request);
    const userId = request.headers.get('X-User-Id') || (session?.user as any)?.id;
    
    // Build headers for backend request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    
    // Add X-User-Id if available
    if (userId) {
      headers['X-User-Id'] = userId;
    }
    
    // Forward Authorization header if present (JWT token)
    const authorization = request.headers.get('Authorization');
    if (authorization) {
      headers['Authorization'] = authorization;
    }
    
    // Use the id directly as UUID for the backend API
    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${id}`;
    
    console.log('🔍 FORMATIONS-PRO API: Deleting formation:', {
      id,
      tenantId,
      userId,
      url: backendUrl
    });
    
    try {
      const response = await fetch(backendUrl, {
        method: 'DELETE',
        headers,
      });

      console.log('📊 FORMATIONS-PRO API: Backend response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }
        
        console.error('❌ FORMATIONS-PRO API: Backend error:', {
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
      console.log('✅ FORMATIONS-PRO API: Formation deleted successfully');
      return NextResponse.json(data);
    } catch (fetchError: any) {
      console.error('❌ FORMATIONS-PRO API: Fetch error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to connect to backend API', details: fetchError.message },
        { status: 503 }
      );
    }
  } catch (error: any) {
    console.error('❌ FORMATIONS-PRO API: Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

