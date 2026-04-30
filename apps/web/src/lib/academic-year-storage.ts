"use client";

const ACTIVE_ACADEMIC_YEAR_KEY = "activeAcademicYearId";

export function getActiveAcademicYearId(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(ACTIVE_ACADEMIC_YEAR_KEY);
  return value && value.trim().length > 0 ? value : null;
}

export function setActiveAcademicYearId(academicYearId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_ACADEMIC_YEAR_KEY, academicYearId);
}

export function clearActiveAcademicYearId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACTIVE_ACADEMIC_YEAR_KEY);
}

