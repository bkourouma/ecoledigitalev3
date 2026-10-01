import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { tenantFallback } from '@/platform/tenant/server';

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const tenantId = request.headers.get("X-Tenant") || tenantFallback(request);
    const userId = request.headers.get("X-User-Id") || session.user.id;
    const authorization = request.headers.get("Authorization");
    const activeAcademicYearId = request.headers.get("X-Academic-Year-Id");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Tenant": tenantId,
      "X-User-Id": userId,
    };

    if (authorization) {
      headers.Authorization = authorization;
    }
    if (activeAcademicYearId) {
      headers["X-Academic-Year-Id"] = activeAcademicYearId;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1/students/me`, {
      method: "GET",
      headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data.error || "Failed to fetch current student",
          message: data.message,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in /api/v1/students/me proxy:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

