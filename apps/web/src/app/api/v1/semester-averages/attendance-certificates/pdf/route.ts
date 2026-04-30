import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy explicite vers l'API Fastify pour éviter le timeout du rewrite Next.js (dev)
 * sur les générations PDF longues (Word + LibreOffice / Puppeteer).
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:4000";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function forwardHeaders(req: NextRequest): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": req.headers.get("content-type") || "application/json",
  };
  const auth = req.headers.get("authorization");
  if (auth) {
    h.Authorization = auth;
  }
  const tenant = req.headers.get("x-tenant");
  if (tenant) {
    h["X-Tenant"] = tenant;
  }
  const userId = req.headers.get("x-user-id");
  if (userId) {
    h["X-User-Id"] = userId;
  }
  const cookie = req.headers.get("cookie");
  if (cookie) {
    h.Cookie = cookie;
  }
  return h;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const upstream = await fetch(
      `${API_BASE_URL}/api/v1/semester-averages/attendance-certificates/pdf`,
      {
        method: "POST",
        headers: forwardHeaders(req),
        body,
      }
    );

    if (!upstream.ok) {
      const ct = upstream.headers.get("content-type");
      if (ct?.includes("application/json")) {
        const err = await upstream.json().catch(() => ({}));
        return NextResponse.json(err, { status: upstream.status });
      }
      const text = await upstream.text();
      return new NextResponse(text, { status: upstream.status });
    }

    const blob = await upstream.blob();
    const cd = upstream.headers.get("content-disposition");
    const ct = upstream.headers.get("content-type") || "application/pdf";

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": ct,
        ...(cd ? { "Content-Disposition": cd } : {}),
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[attendance-certificates/pdf] proxy error:", e);
    return NextResponse.json(
      { error: "Proxy error", message: msg },
      { status: 500 }
    );
  }
}
