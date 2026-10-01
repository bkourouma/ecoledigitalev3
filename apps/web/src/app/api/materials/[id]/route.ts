import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: materialId } = await params;
    const session = await getServerSession(authOptions);
    
    // Get tenant and user ID from session or headers
    const tenant = session?.tenantId || request.headers.get('X-Tenant') || tenantFallback(request);
    const userId = session?.user?.id || request.headers.get('X-User-Id') || '634a57fe-2007-4ecb-ae5b-f9e3152a24fb';
    const auth = request.headers.get('Authorization');

    // Forward the request to the backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/courses/materials/${materialId}`, {
      method: 'GET',
      headers: {
      "Content-Type": "application/json",
        "X-Tenant": tenant,
        "X-User-Id": userId,
        ...(auth ? { "Authorization": auth } : {}),
    },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Material not found' },
        { status: response.status }
      );
    }

    const material = await response.json();
    return NextResponse.json(material);

  } catch (error) {
    console.error('Error fetching material:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: materialId } = await params;
    const session = await getServerSession(authOptions);
    
    // Get tenant and user ID from session or headers
    const tenant = session?.tenantId || request.headers.get('X-Tenant') || tenantFallback(request);
    const userId = session?.user?.id || request.headers.get('X-User-Id') || '634a57fe-2007-4ecb-ae5b-f9e3152a24fb';
    const auth = request.headers.get('Authorization');

    // Forward the delete request to the backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/courses/materials/${materialId}`, {
      method: 'DELETE',
      headers: {
      "Content-Type": "application/json",
        "X-Tenant": tenant,
        "X-User-Id": userId,
        ...(auth ? { "Authorization": auth } : {}),
    },
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Backend API error:', response.status, errorData);
      let errorMessage = 'Failed to delete material';
      try {
        const errorJson = JSON.parse(errorData);
        errorMessage = errorJson.message || errorJson.error || errorMessage;
      } catch {
        // If errorData is not JSON, use the text as is
        errorMessage = errorData || errorMessage;
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error('Error deleting material:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to delete material' },
      { status: 500 }
    );
  }
}
