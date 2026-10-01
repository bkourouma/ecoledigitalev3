import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
export const dynamic = "force-dynamic";

function buildProxyHeaders(request: NextRequest, session: Awaited<ReturnType<typeof getServerSession>>) {
  const tenant = session?.tenantId || request.headers.get("X-Tenant") || tenantFallback(request);
  const userId = session?.user?.id || request.headers.get("X-User-Id") || "";
  const sessionJwt = (session as any)?.jwtToken as string | undefined;
  const authorization = sessionJwt ? `Bearer ${sessionJwt}` : request.headers.get("Authorization");
  const activeAcademicYearId = request.headers.get("X-Academic-Year-Id");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Tenant": tenant,
  };

  if (userId) {
    headers["X-User-Id"] = userId;
  }

  if (authorization) {
    headers.Authorization = authorization;
  }

  if (activeAcademicYearId) {
    headers["X-Academic-Year-Id"] = activeAcademicYearId;
  }

  return headers;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const queryString = request.nextUrl.searchParams.toString();
    const response = await fetch(
      `${API_BASE_URL}/api/v1/parents${queryString ? `?${queryString}` : ""}`,
      {
        method: "GET",
        headers: buildProxyHeaders(request, session),
        cache: "no-store",
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data.error || "Failed to fetch parents",
          message: data.message,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in /api/v1/parents proxy:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const response = await fetch(`${API_BASE_URL}/api/v1/parents`, {
      method: "POST",
      headers: buildProxyHeaders(request, session),
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data.error || "Failed to create parent",
          message: data.message,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error in POST /api/v1/parents proxy:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
