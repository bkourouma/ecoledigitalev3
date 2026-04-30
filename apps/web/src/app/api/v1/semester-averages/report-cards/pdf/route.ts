import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:4000";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function forwardHeaders(req: NextRequest): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") || "application/json",
  };

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const upstream = await fetch(`${API_BASE_URL}/api/v1/semester-averages/report-cards/pdf`, {
      method: "POST",
      headers: forwardHeaders(req),
      body,
    });

    if (!upstream.ok) {
      const contentType = upstream.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const error = await upstream.json().catch(() => ({}));
        return NextResponse.json(error, { status: upstream.status });
      }

      const text = await upstream.text();
      return new NextResponse(text, { status: upstream.status });
    }

    const blob = await upstream.blob();
    const contentDisposition = upstream.headers.get("content-disposition");
    const contentType = upstream.headers.get("content-type") || "application/pdf";

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        ...(contentDisposition ? { "Content-Disposition": contentDisposition } : {}),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[report-cards/pdf] proxy error:", error);
    return NextResponse.json(
      { error: "Proxy error", message },
      { status: 500 }
    );
  }
}
