import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ supportId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { supportId } = await params;
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const tenantId = request.headers.get("X-Tenant") || (session as any)?.tenantId || tenantFallback(request);
    const authHeader = request.headers.get("Authorization");
    const sessionJwt = (session as any)?.jwtToken as string | undefined;

    const headers: Record<string, string> = {
      "X-Tenant": tenantId,
    };

    if (authHeader) {
      headers["Authorization"] = authHeader;
    } else if (sessionJwt) {
      headers["Authorization"] = `Bearer ${sessionJwt}`;
    }

    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/videos/${encodeURIComponent(
      supportId
    )}/playback?slug=${encodeURIComponent(slug)}`;

    const response = await fetch(backendUrl, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text || `HTTP ${response.status}` };
      }
      return NextResponse.json(payload, { status: response.status });
    }

    const contentType = response.headers.get("content-type") || "video/mp4";
    const contentLength = response.headers.get("content-length");

    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        ...(contentLength ? { "Content-Length": contentLength } : {}),
        "Accept-Ranges": response.headers.get("accept-ranges") || "bytes",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Internal server error", message: error?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
