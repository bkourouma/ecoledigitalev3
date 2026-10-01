"use client";

import Link from "next/link";
import { useClassroom } from "@/platform/v2/academic";
import { useStudent } from "@/platform/v2/people";

/** Nom d'un élève (requête mise en cache et partagée par ligne) ; repli sur le début de l'identifiant si la fiche est inaccessible. */
export function StudentLabel({ studentId, link = true }: { studentId: string; link?: boolean }) {
  const q = useStudent(studentId);
  const text = q.data ? q.data.displayName : q.isError ? `${studentId.slice(0, 8)}…` : "…";
  if (!link || !q.data) return <span className="font-medium">{text}</span>;
  return (
    <Link href={`/v2/students/${studentId}`} className="font-medium text-primary underline-offset-4 hover:underline">
      {text}
    </Link>
  );
}

export function ClassroomLabel({ classroomId, link = true }: { classroomId: string; link?: boolean }) {
  const q = useClassroom(classroomId);
  const text = q.data ? q.data.name : q.isError ? `${classroomId.slice(0, 8)}…` : "…";
  if (!link || !q.data) return <span>{text}</span>;
  return (
    <Link href={`/v2/academic/classrooms/${classroomId}`} className="text-primary underline-offset-4 hover:underline">
      {text}
    </Link>
  );
}

export function enrollmentTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "PENDING":
      return "info";
    case "SUSPENDED":
      return "warning";
    case "WITHDRAWN":
    case "TRANSFERRED_OUT":
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}
