import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

/**
 * Proxy multipart upload for the single catalogue support (Imhotep-style tenants).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = request.headers.get("X-Tenant") || "";
    const userId = request.headers.get("X-User-Id") || "";
    const authorization = request.headers.get("Authorization");

    if (!authorization) {
      return NextResponse.json(
        { success: false, error: "AUTH_REQUIRED", message: "Authentification requise" },
        { status: 401 }
      );
    }

    const formData = await request.formData();

    const headers: Record<string, string> = {
      Authorization: authorization,
    };
    if (tenantId) headers["X-Tenant"] = tenantId;
    if (userId) headers["X-User-Id"] = userId;

    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${id}/catalogue-support`;

    const response = await fetch(backendUrl, {
      method: "POST",
      headers,
      body: formData,
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || `HTTP ${response.status}` };
    }

    return NextResponse.json(data as object, { status: response.status });
  } catch (error: unknown) {
    console.error("catalogue-support proxy:", error);
    return NextResponse.json(
      { success: false, error: "PROXY_ERROR", message: "Échec de l'envoi au serveur" },
      { status: 500 }
    );
  }
}
