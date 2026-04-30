"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input, Label } from "@ecoledigitale/ui";
import { createApiHeaders } from "@/lib/api-utils";

type ClassItem = { id: string; name: string };
type CourseItem = { id: string; name: string; code: string };
type TeacherAssignmentItem = {
  classId: string;
  className: string;
  courseId: string;
  courseName: string;
  courseCode?: string;
};

interface Props {
  onCreated: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialStart?: Date | null;
  initialEnd?: Date | null;
  hideTrigger?: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");

const formatDateInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const formatTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const toIsoFromLocal = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

export default function AddSessionDialog({
  onCreated,
  open: controlledOpen,
  onOpenChange,
  initialStart = null,
  initialEnd = null,
  hideTrigger = false,
}: Props) {
  const { data: session } = useSession();
  const userId = (session as any)?.user?.id;
  const [internalOpen, setInternalOpen] = useState(false);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [courseId, setCourseId] = useState<string>("");
  const [coursesByClass, setCoursesByClass] = useState<Record<string, CourseItem[]>>({});
  const [startDate, setStartDate] = useState<string>("");
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  useEffect(() => {
    if (!open) {
      return;
    }

    if (initialStart) {
      setStartDate(formatDateInput(initialStart));
      setStartTime(formatTimeInput(initialStart));
    }
    if (initialEnd) {
      setEndTime(formatTimeInput(initialEnd));
    }
  }, [open, initialStart, initialEnd]);

  useEffect(() => {
    if (!open || !userId || !session) {
      setClasses([]);
      setCourses([]);
      setCoursesByClass({});
      setClassId("");
      setCourseId("");
      return;
    }

    setIsLoadingAssignments(true);
    const headers = createApiHeaders(session);
    headers["X-User-Id"] = userId;

    fetch("/api/v1/teacher-assignments?status=active&limit=100", { headers })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
        return r.json();
      })
      .then((j) => {
        const assignments: TeacherAssignmentItem[] = Array.isArray(j?.data) ? j.data : [];

        const classesMap = new Map<string, ClassItem>();
        const coursesMapByClass = new Map<string, Map<string, CourseItem>>();

        assignments.forEach((a) => {
          if (!a.classId || !a.courseId) return;

          if (!classesMap.has(a.classId)) {
            classesMap.set(a.classId, {
              id: a.classId,
              name: a.className || "Classe",
            });
          }

          if (!coursesMapByClass.has(a.classId)) {
            coursesMapByClass.set(a.classId, new Map<string, CourseItem>());
          }

          const courseMap = coursesMapByClass.get(a.classId)!;
          if (!courseMap.has(a.courseId)) {
            courseMap.set(a.courseId, {
              id: a.courseId,
              name: a.courseName || "Cours",
              code: a.courseCode || "",
            });
          }
        });

        const nextClasses = Array.from(classesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        const nextCoursesByClass: Record<string, CourseItem[]> = {};
        for (const [cid, cMap] of coursesMapByClass.entries()) {
          nextCoursesByClass[cid] = Array.from(cMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        }

        setClasses(nextClasses);
        setCoursesByClass(nextCoursesByClass);
      })
      .catch((err) => {
        console.error("Error fetching teacher assignments:", err);
        setClasses([]);
        setCoursesByClass({});
      })
      .finally(() => {
        setIsLoadingAssignments(false);
      });
  }, [open, userId, session]);

  useEffect(() => {
    if (!classId) {
      setCourses([]);
      setCourseId("");
      return;
    }

    const assignedCourses = coursesByClass[classId] || [];
    setCourses(assignedCourses);
    if (!assignedCourses.some((c) => c.id === courseId)) {
      setCourseId("");
    }
  }, [classId, coursesByClass, courseId]);

  const canSubmit = useMemo(
    () => !!classId && !!courseId && !!startDate && !!startTime && !!endTime,
    [classId, courseId, startDate, startTime, endTime]
  );

  const submit = async () => {
    if (!userId || !session) return;
    const startDateTime = toIsoFromLocal(startDate, startTime);
    const endDateTime = toIsoFromLocal(startDate, endTime);

    if (new Date(startDateTime) >= new Date(endDateTime)) {
      alert("L'heure de fin doit être après l'heure de début le même jour.");
      return;
    }

    try {
      const headers = createApiHeaders(session);
      headers["Content-Type"] = "application/json";
      const res = await fetch("/api/v1/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({ classId, courseId, startDateTime, endDateTime }),
      });

      if (res.ok) {
        setOpen(false);
        setClassId(""); setCourseId(""); setStartDate(""); setStartTime(""); setEndTime("");
        onCreated();
        return;
      }

      let errorMessage = "";
      try {
        const json = await res.json();
        errorMessage = String(json?.message || "");
      } catch {
        const text = await res.text().catch(() => "");
        errorMessage = text || `Erreur HTTP ${res.status}`;
      }

      const rawMessage = errorMessage.toLowerCase();
      const isOverlapError =
        rawMessage.includes("overlapping session") ||
        rawMessage.includes("overlap") ||
        rawMessage.includes("teacher or class");

      if (isOverlapError) {
        alert("Conflit d'horaire : cette session chevauche un autre cours déjà planifié pour vous ou pour la classe.");
      } else {
        alert(errorMessage || "Erreur lors de la création de la session");
      }
    } catch (err) {
      console.warn("Session creation failed:", err);
      alert("Impossible de créer la session pour le moment. Vérifiez votre connexion puis réessayez.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button size="sm">Ajouter une session</Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle session</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Classe</Label>
            <Select value={classId} onValueChange={setClassId} disabled={isLoadingAssignments}>
              <SelectTrigger>
                <SelectValue placeholder={isLoadingAssignments ? "Chargement..." : "Sélectionner une classe"} />
              </SelectTrigger>
              <SelectContent>
                {classes.length === 0 && !isLoadingAssignments ? (
                  <SelectItem value="no-classes" disabled>Aucune classe disponible</SelectItem>
                ) : (
                  classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Cours</Label>
            <Select value={courseId} onValueChange={setCourseId} disabled={!classId || isLoadingAssignments}>
              <SelectTrigger>
                <SelectValue placeholder={isLoadingAssignments ? "Chargement..." : !classId ? "Sélectionnez d'abord une classe" : "Sélectionner un cours"} />
              </SelectTrigger>
              <SelectContent>
                {courses.length === 0 && !isLoadingAssignments ? (
                  <SelectItem value="no-courses" disabled>Aucun cours disponible</SelectItem>
                ) : (
                  courses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Date début</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Heure début</Label>
              <Input type="time" step={900} value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label>Heure fin</Label>
              <Input type="time" step={900} value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} disabled={!canSubmit}>Créer</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


