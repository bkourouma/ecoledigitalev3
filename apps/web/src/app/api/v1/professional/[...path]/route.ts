import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

/**
 * Proxy Next.js (catch-all) du Module Professionnel — feature 028.
 *
 * Relaie tout `/api/v1/professional/*` vers l'API Fastify, en transmettant le
 * contexte tenant (X-Tenant), l'utilisateur (X-User-Id) et le JWT
 * (Authorization). Utilisé par les hooks TanStack Query côté web.
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  try {
    const { path } = await context.params;
    const subPath = (path ?? []).join("/");
    const { search } = new URL(request.url);
    const backendUrl = `${API_BASE_URL}/api/v1/professional/${subPath}${search}`;

    const session = await getServerSession(authOptions);

    const headers: Record<string, string> = {};

    const tenantId = request.headers.get("X-Tenant") || (session as any)?.tenantId;
    if (tenantId) headers["X-Tenant"] = tenantId;

    const userId = request.headers.get("X-User-Id") || session?.user?.id;
    if (userId) headers["X-User-Id"] = userId;

    const incomingAuth = request.headers.get("authorization");
    if (incomingAuth) headers["Authorization"] = incomingAuth;

    const method = request.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
    const incomingCT = request.headers.get("content-type") || "";
    const isMultipart = incomingCT.toLowerCase().startsWith("multipart/");

    let fetchBody: BodyInit | undefined;
    if (hasBody) {
      if (isMultipart) {
        // Préserver le boundary multipart : on transmet le buffer brut + le Content-Type tel quel.
        const buf = await request.arrayBuffer();
        fetchBody = buf.byteLength > 0 ? buf : undefined;
        if (fetchBody) headers["Content-Type"] = incomingCT;
      } else {
        const rawBody = await request.text();
        if (rawBody && rawBody.length > 0) {
          fetchBody = rawBody;
          headers["Content-Type"] = incomingCT || "application/json";
        }
      }
    }
    // Note : si pas de corps on n'envoie aucun Content-Type (Fastify rejette FST_ERR_CTP_EMPTY_JSON_BODY).

    const response = await fetch(backendUrl, {
      method,
      headers,
      body: fetchBody,
    });

    // Transmettre tel quel les contenus non-JSON (binaires : PDF, vidéo, image, ZIP…
    // ET aussi les text/plain, text/csv, etc. — tout ce qui n'est PAS application/json).
    // Un Content-Disposition (inline / attachment) signale aussi un fichier à transmettre.
    const upstreamCT = response.headers.get("content-type") || "";
    const upstreamCD = response.headers.get("content-disposition") || "";
    const isJson = upstreamCT.includes("application/json");
    if (!isJson) {
      const buf = await response.arrayBuffer();
      const passthroughHeaders = new Headers();
      passthroughHeaders.set("Content-Type", upstreamCT || "application/octet-stream");
      if (upstreamCD) passthroughHeaders.set("Content-Disposition", upstreamCD);
      const cl = response.headers.get("content-length");
      if (cl) passthroughHeaders.set("Content-Length", cl);
      const cc = response.headers.get("cache-control");
      if (cc) passthroughHeaders.set("Cache-Control", cc);
      return new NextResponse(buf, { status: response.status, headers: passthroughHeaders });
    }

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { success: false, error: "UPSTREAM_NON_JSON", message: text };
      }
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: "PROXY_ERROR",
        message: error?.message ?? "Failed to reach the professional module API",
      },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
