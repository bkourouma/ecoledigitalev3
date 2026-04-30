import { NextRequest, NextResponse } from 'next/server';
import FormData from 'form-data';

export const runtime = 'nodejs';
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;

    const auth = request.headers.get('authorization') ?? '';
    const host = request.headers.get('host') ?? '';
    const tenant = host.includes('localhost') ? 'imhotepacademy' : host.split('.')[0];
    const userId = request.headers.get('x-user-id') ?? '';


    // Connect to backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/courses/${courseId}/materials`, {
      method: 'GET',
      headers: {
        ...(auth ? { 'authorization': auth } : {}),
        ...(userId ? { 'X-User-Id': userId } : {}),
        'X-Tenant': tenant,
      },
    });

    if (!response.ok) {
      throw new Error(`Backend API error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching materials:', error);
    return NextResponse.json(
      { error: 'Failed to fetch materials' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const { courseId } = await params;

    // Get the raw body as a Uint8Array
    const bodyBuffer = await request.arrayBuffer();

    // Get the content-type header from the incoming request (includes boundary)
    const contentType = request.headers.get('content-type') ?? '';

    const auth = request.headers.get('authorization') ?? '';
    const host = request.headers.get('host') ?? '';
    const userId = request.headers.get('x-user-id') ?? '';

    const tenant = host.includes('localhost') ? 'imhotepacademy' : host.split('.')[0];

    // Forward the raw multipart body directly to the backend
    const response = await fetch(`${API_BASE_URL}/api/v1/courses/${courseId}/materials`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        ...(auth ? { authorization: auth } : {}),
        ...(userId ? { 'X-User-Id': userId } : {}),
        'X-Tenant': tenant,
      },
      body: bodyBuffer,
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Backend API error:', response.status, errorData);
      throw new Error(`Backend API error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('Error uploading file:', error);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}


