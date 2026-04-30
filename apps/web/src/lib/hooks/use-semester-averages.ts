"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const headers = {
  "Content-Type": "application/json",
};

export interface ManualStudentRow {
  studentId: string;
  studentNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  average: number | null;
}

export interface MatrixCourse {
  id: string;
  code: string;
  name: string;
  /** Peut être absent selon la version API ; le front complète via /courses si besoin. */
  coef?: number;
}

export interface MatrixStudent {
  studentId: string;
  studentNumber: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface MatrixAttendanceRow {
  absenceHours: number;
  justifiedHours: number;
}

export interface SemesterMatrixData {
  className: string;
  academicYearName: string;
  periodName: string;
  courses: MatrixCourse[];
  students: MatrixStudent[];
  averages: Record<string, Record<string, number>>;
  attendance: Record<string, MatrixAttendanceRow>;
}

async function fetchManual(classId: string, courseId: string, periodId: string) {
  const q = new URLSearchParams({ classId, courseId, periodId });
  const res = await fetch(`/api/v1/semester-averages/manual?${q}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.statusText);
  }
  return res.json() as Promise<{ data: { students: ManualStudentRow[] } }>;
}

async function fetchMatrix(classId: string, periodId: string) {
  const q = new URLSearchParams({ classId, periodId });
  const res = await fetch(`/api/v1/semester-averages/matrix?${q}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.statusText);
  }
  return res.json() as Promise<{ data: SemesterMatrixData }>;
}

export function useSemesterManual(classId: string | undefined, courseId: string | undefined, periodId: string | undefined) {
  return useQuery({
    queryKey: ["semester-averages-manual", classId, courseId, periodId],
    queryFn: () => fetchManual(classId!, courseId!, periodId!),
    enabled: Boolean(classId && courseId && periodId),
  });
}

export function useSemesterMatrix(classId: string | undefined, periodId: string | undefined) {
  return useQuery({
    queryKey: ["semester-averages-matrix", classId, periodId],
    queryFn: () => fetchMatrix(classId!, periodId!),
    enabled: Boolean(classId && periodId),
  });
}

export function useSaveSemesterManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      classId: string;
      courseId: string;
      periodId: string;
      grades: { studentId: string; average: number | null }[];
    }) => {
      const res = await fetch("/api/v1/semester-averages/manual", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["semester-averages-manual"] });
      qc.invalidateQueries({ queryKey: ["semester-averages-matrix"] });
    },
  });
}

export function useSaveSemesterMatrix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      classId: string;
      periodId: string;
      cells: { studentId: string; courseId: string; average: number | null }[];
      attendance: { studentId: string; absenceHours: number | null; justifiedHours: number | null }[];
    }) => {
      const res = await fetch("/api/v1/semester-averages/matrix", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["semester-averages-matrix"] });
      qc.invalidateQueries({ queryKey: ["semester-averages-manual"] });
    },
  });
}

export async function generateAttendanceCertificatesPdf(classId: string, periodId: string) {
  const res = await fetch("/api/v1/semester-averages/attendance-certificates/pdf", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ classId, periodId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.statusText);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename=\"?([^"]+)\"?/i);
  const fileName = match?.[1] || "attestations-frequentation.pdf";
  return { blob, fileName };
}

export async function generateAttendanceCertificatesHtmlPdf(
  classId: string,
  periodId: string,
  studentId?: string
) {
  const res = await fetch("/api/v1/semester-averages/attendance-certificates/pdf-html", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ classId, periodId, ...(studentId ? { studentId } : {}) }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.statusText);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename=\"?([^"]+)\"?/i);
  const fileName = match?.[1] || "attestations-frequentation-html.pdf";
  return { blob, fileName };
}

export async function generateReportCardsPdf(
  classId: string,
  periodId: string,
  studentId?: string
) {
  const reportCardsEndpoint = "/api/v1/semester-averages/report-cards/pdf";

  console.log("[ReportCardsPDF] request", {
    endpoint: reportCardsEndpoint,
    classId,
    periodId,
    studentId: studentId || null,
    localBypass: false,
  });

  const res = await fetch(reportCardsEndpoint, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ classId, periodId, ...(studentId ? { studentId } : {}) }),
  });

  console.log("[ReportCardsPDF] response", {
    endpoint: reportCardsEndpoint,
    status: res.status,
    ok: res.ok,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("[ReportCardsPDF] error payload", err);
    throw new Error(err.message || res.statusText);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename=\"?([^"]+)\"?/i);
  const fileName = match?.[1] || "bulletins.pdf";
  return { blob, fileName };
}
