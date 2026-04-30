import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

function extractUserIdFromAuth(authHeader?: string | null): string | undefined {
  if (!authHeader) return undefined;
  const parts = authHeader.split(' ');
  const token = parts.length === 2 ? parts[1] : parts[0];
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return undefined;
    // base64url decode
    const b64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.userId || payload.sub;
  } catch {
    return undefined;
  }
}

// POST /api/v1/assignments/:assignmentId/submissions/:submissionId/finalize
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string; submissionId: string }> }
) {
  console.log('🎯 [FINALIZE PROXY] POST /api/v1/assignments/[assignmentId]/submissions/[submissionId]/finalize');

  try {
    const { assignmentId, submissionId } = await params;
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      // No body, use empty object
    }

    // Pass-through headers from client; derive missing ones if possible
    const authorization = request.headers.get('Authorization') || '';
    const tenantId = request.headers.get('X-Tenant') || '6eb9c106-b650-4398-b6fa-091b6828c4ba';
    const userId = request.headers.get('X-User-Id') || extractUserIdFromAuth(authorization) || '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
    };
    if (userId) headers['X-User-Id'] = userId;
    if (authorization) headers['Authorization'] = authorization;

    const backendUrl = `${API_BASE_URL}/api/v1/assignments/${assignmentId}/submissions/${submissionId}/finalize`;
    console.log('📤 [FINALIZE PROXY] Calling:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    console.log('📊 [FINALIZE PROXY] Backend response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ [FINALIZE PROXY] Backend error:', response.status, errorText);
      return NextResponse.json(
        { error: errorText || 'Failed to finalize submission' },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ [FINALIZE PROXY] Success!');
    return NextResponse.json(data);

  } catch (error) {
    console.error('❌ [FINALIZE PROXY] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
