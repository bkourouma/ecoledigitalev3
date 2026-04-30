import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:4000'
  : process.env.API_URL || 'http://localhost:4000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // Session can be absent when opening /api/v1/files/... directly in a new tab.
    const session = await getServerSession(authOptions);

    const { path } = await params;
    const filePath = path.join('/');

    // Prefer session tenant context, fallback to the tenant present in URL path.
    const pathTenant = path?.[0];
    const rawTenant =
      (session as any)?.tenantId ||
      (session as any)?.tenantSlug ||
      pathTenant ||
      'imhotepacademy';
    const tenantIdentifier = String(rawTenant || 'imhotepacademy').trim();

    // Backend exige X-User-Id et X-Tenant non vides (sinon 401 � Authentification requise �).
    const requestUserId = String((session as any)?.user?.id || 'public-file-access').trim() || 'public-file-access';

    console.log('FILE SERVE request:', {
      filePath,
      userId: requestUserId,
      tenantId: tenantIdentifier,
      hasSession: !!(session as any)?.user?.id,
    });

    // Transmettre la query (ex. /serve-file?tenantId=&courseId=&filename=) � sinon le backend renvoie 400.
    const query = request.nextUrl.search ?? "";
    const backendUrl = `${API_BASE_URL}/api/v1/files/${filePath}${query}`;

    const headers: Record<string, string> = {
      // Lowercase header names to match Fastify lookups (request.headers['x-tenant'], etc.)
      'x-tenant': tenantIdentifier,
      'x-user-id': requestUserId,
    };

    // Forward JWT from session if available.
    if ((session as any)?.jwtToken) {
      headers['authorization'] = `Bearer ${(session as any).jwtToken}`;
    }

    // Forward incoming Authorization if present.
    const authorization = request.headers.get('Authorization');
    if (authorization) {
      headers['authorization'] = authorization;
    }

    // M�me origine : transmettre les cookies pour que l�API puisse r�soudre l�utilisateur si besoin.
    const cookie = request.headers.get('cookie');
    if (cookie) {
      headers['cookie'] = cookie;
    }

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      let errorMessage = 'File not found';
      try {
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch {
        // Keep default error message.
      }

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: response.status }
      );
    }

    // Stream backend response directly to avoid buffering large media files in memory
    // (which can cause browser-side ERR_FAILED despite backend 200 in dev).
    const fileResponse = new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
    });

    const contentType = response.headers.get('content-type');
    const contentDisposition = response.headers.get('content-disposition');
    const cacheControl = response.headers.get('cache-control');
    const acceptRanges = response.headers.get('accept-ranges');

    if (contentType) fileResponse.headers.set('Content-Type', contentType);
    if (contentDisposition) fileResponse.headers.set('Content-Disposition', contentDisposition);
    if (cacheControl) fileResponse.headers.set('Cache-Control', cacheControl);
    if (acceptRanges) fileResponse.headers.set('Accept-Ranges', acceptRanges);

    fileResponse.headers.set('X-Content-Type-Options', 'nosniff');
    // SAMEORIGIN : permet l�aper�u PDF/vid�o en iframe sur le m�me site (ex. fiche formation catalogue).
    fileResponse.headers.set('X-Frame-Options', 'SAMEORIGIN');
    return fileResponse;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
