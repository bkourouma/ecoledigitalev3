import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    const { studentId } = await params;
    const academicYearIdFromQuery = request.nextUrl.searchParams.get("academicYearId");
    const tenantId = request.headers.get("X-Tenant") || "imhotepacademy";
    const userId = request.headers.get("X-User-Id") || session.user.id;
    const authorization = request.headers.get("Authorization");
    const activeAcademicYearId = request.headers.get("X-Academic-Year-Id") || academicYearIdFromQuery;

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

    const response = await fetch(
      `${API_BASE_URL}/api/v1/student-payments/${studentId}${academicYearIdFromQuery ? `?academicYearId=${encodeURIComponent(academicYearIdFromQuery)}` : ""}`,
      {
        method: "GET",
        headers,
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data.error || "Failed to fetch payment summary",
          message: data.message,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in student-payments proxy:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

