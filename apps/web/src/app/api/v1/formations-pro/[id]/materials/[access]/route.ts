import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; access: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id, access } = await params;

    if (access !== "public" && access !== "unlocked") {
      return NextResponse.json({ error: "Invalid access type" }, { status: 400 });
    }

    const tenantId = request.headers.get("X-Tenant") || (session as any)?.tenantId || "imhotepdata";
    const authHeader = request.headers.get("Authorization");
    const sessionJwt = (session as any)?.jwtToken as string | undefined;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Tenant": tenantId,
    };

    if (authHeader) {
      headers["Authorization"] = authHeader;
    } else if (sessionJwt) {
      headers["Authorization"] = `Bearer ${sessionJwt}`;
    }

    const backendUrl = `${API_BASE_URL}/api/v1/formations-pro/${encodeURIComponent(id)}/materials/${access}`;
    const response = await fetch(backendUrl, { method: "GET", headers });

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || `HTTP ${response.status}` };
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Internal server error", message: error?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
