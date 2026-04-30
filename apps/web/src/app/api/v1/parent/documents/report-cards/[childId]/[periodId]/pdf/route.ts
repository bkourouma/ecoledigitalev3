import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:4000";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function forwardHeaders(req: NextRequest): HeadersInit {
  const headers: Record<string, string> = {};

  const auth = req.headers.get("authorization");
  if (auth) {
    headers.Authorization = auth;
  }

  const tenant = req.headers.get("x-tenant");
  if (tenant) {
    headers["X-Tenant"] = tenant;
  }

  const userId = req.headers.get("x-user-id");
  if (userId) {
    headers["X-User-Id"] = userId;
  }

  const cookie = req.headers.get("cookie");
  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

type RouteParams = {
  params: Promise<{
    childId: string;
    periodId: string;
  }>;
};

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { childId, periodId } = await params;
    const query = req.nextUrl.search || "";
    const upstreamUrl = `${API_BASE_URL}/api/v1/parent/documents/report-cards/${childId}/${periodId}/pdf${query}`;

    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: forwardHeaders(req),
    });

    const contentType = upstream.headers.get("content-type") || "application/json";

    if (!upstream.ok) {
      if (contentType.includes("application/json")) {
        const error = await upstream.json().catch(() => ({}));
        return NextResponse.json(error, { status: upstream.status });
      }
      const text = await upstream.text();
      return new NextResponse(text, { status: upstream.status });
    }

    const blob = await upstream.blob();
    const contentDisposition = upstream.headers.get("content-disposition");

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        ...(contentDisposition ? { "Content-Disposition": contentDisposition } : {}),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Proxy error", message }, { status: 500 });
  }
}

