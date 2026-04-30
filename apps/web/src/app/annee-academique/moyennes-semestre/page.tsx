"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function formatFrFixed(n: number, digits: number) {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ecoledigitale/ui";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";
import { useAcademicYearPeriods } from "@/lib/hooks/use-academic-year-periods";
import { useClasses } from "@/lib/hooks/use-classes";
import { useCourses } from "@/lib/hooks/use-courses";
import {
  generateAttendanceCertificatesPdf,
  generateAttendanceCertificatesHtmlPdf,
  generateReportCardsPdf,
  useSemesterMatrix,
  useSaveSemesterMatrix,
} from "@/lib/hooks/use-semester-averages";
import { FileDown, FileUp, Maximize2, Minimize2, Save, Table2, FileText } from "lucide-react";

function parseGradeCell(val: unknown): number | null {
  if (val === "" || val == null) return null;
  if (typeof val === "number" && Number.isFinite(val)) {
    const clamped = Math.min(20, Math.max(0, val));
    return Math.round(clamped * 100) / 100;
  }
  const t = String(val).trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(20, Math.max(0, n));
  return Math.round(clamped * 100) / 100;
}

function sanitizeIntegerGradeInput(raw: string): string {
  const normalized = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  if (normalized === "") return "";
  const [intPartRaw, ...decimalParts] = normalized.split(".");
  const intPart = intPartRaw === "" ? "0" : intPartRaw;
  const decimalPart = decimalParts.join("").slice(0, 2);
  const candidate = decimalParts.length > 0 ? `${intPart}.${decimalPart}` : intPart;
  const parsed = Number.parseFloat(candidate);
  if (!Number.isFinite(parsed)) return "";
  const clamped = Math.min(20, Math.max(0, parsed));
  return decimalParts.length > 0 ? clamped.toFixed(decimalPart.length) : String(Math.trunc(clamped));
}

function parseHourCell(val: unknown): number | null {
  if (val === "" || val == null) return null;
  const normalized = String(val).trim().replace(",", ".");
  if (normalized === "") return null;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function sanitizeHourInput(raw: string): string {
  if (!raw) return "";
  const normalized = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const firstDot = normalized.indexOf(".");
  if (firstDot === -1) return normalized;
  const integerPart = normalized.slice(0, firstDot + 1);
  const decimals = normalized.slice(firstDot + 1).replace(/\./g, "");
  return `${integerPart}${decimals}`;
}

function parsePositiveCoef(val: unknown): number | null {
  if (val === "" || val == null) return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Coefficient matière : API matrice puis liste cours du programme (comme /academic/courses). */
function resolveCourseCoef(primary: unknown, fallback?: unknown): number {
  return parsePositiveCoef(primary) ?? parsePositiveCoef(fallback) ?? 1;
}

export default function MoyennesSemestrePage() {
  const { data: activeYearRes, isLoading: loadingYear } = useActiveAcademicYear();
  const activeYear = activeYearRes?.data;

  const { data: periodsData } = useAcademicYearPeriods(activeYear?.id);
  const periods = periodsData?.data ?? [];

  const { data: classesRes, isLoading: loadingClasses } = useClasses(
    {
      academicYearId: activeYear?.id,
      includeDetails: true,
      limit: 100,
      page: 1,
    },
    { enabled: !!activeYear?.id }
  );
  const classes = classesRes?.data ?? [];

  const [periodId, setPeriodId] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  const [studentSearch, setStudentSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const classProgrammeId = classes.find((c) => c.id === classId)?.programmeId;
  const { data: programmeCoursesRes } = useCourses(
    {
      ...(classProgrammeId ? { programmeId: classProgrammeId } : {}),
      limit: 100,
      page: 1,
    },
    { enabled: !!classProgrammeId }
  );
  const programmeCoursesForClass = programmeCoursesRes?.data ?? [];

  useEffect(() => {
    if (periods.length && !periodId) {
      setPeriodId(periods[0].id);
    }
  }, [periods, periodId]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const matrixQuery = useSemesterMatrix(classId || undefined, periodId || undefined);
  const [draftMatrix, setDraftMatrix] = useState<Record<string, string>>({});
  const [draftAttendance, setDraftAttendance] = useState<
    Record<string, { absenceHours: string; justifiedHours: string }>
  >({});
  /** Évite d'écraser la saisie à chaque refetch (focus onglet, invalidateQueries, etc.) */
  const matrixDraftContextRef = useRef<string>("");

  useEffect(() => {
    const matrix = matrixQuery.data?.data;
    if (!matrix || !classId || !periodId) return;
    const courseSig = [...matrix.courses.map((c) => c.id)].sort().join("|");
    const ctx = `${classId}:${periodId}:${courseSig}`;
    if (matrixDraftContextRef.current === ctx) return;
    matrixDraftContextRef.current = ctx;
    const next: Record<string, string> = {};
    const nextAttendance: Record<string, { absenceHours: string; justifiedHours: string }> = {};
    for (const student of matrix.students) {
      for (const course of matrix.courses) {
        const val = matrix.averages[student.studentId]?.[course.id];
        next[`${student.studentId}::${course.id}`] = val != null ? String(val) : "";
      }
      const attendance = matrix.attendance?.[student.studentId];
      nextAttendance[student.studentId] = {
        absenceHours: attendance?.absenceHours != null ? String(attendance.absenceHours) : "",
        justifiedHours: attendance?.justifiedHours != null ? String(attendance.justifiedHours) : "",
      };
    }
    setDraftMatrix(next);
    setDraftAttendance(nextAttendance);
  }, [classId, periodId, matrixQuery.data]);

  const saveMatrix = useSaveSemesterMatrix();
  const excelFileRef = useRef<HTMLInputElement>(null);
  const [isGeneratingCertificates, setIsGeneratingCertificates] = useState(false);
  const [isGeneratingHtmlCertificates, setIsGeneratingHtmlCertificates] = useState(false);
  const [isGeneratingReportCards, setIsGeneratingReportCards] = useState(false);
  const [generatingStudentId, setGeneratingStudentId] = useState<string | null>(null);
  const [generatingReportCardStudentId, setGeneratingReportCardStudentId] = useState<string | null>(null);
  const matrix = matrixQuery.data?.data;

  const programmeCoefByCourseId = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of programmeCoursesForClass) {
      const k = parsePositiveCoef(c.coef);
      if (k != null) m.set(c.id, k);
    }
    return m;
  }, [programmeCoursesForClass]);

  /** Cours de la matrice avec coef fiable (API + fallback page Matières). */
  const coursesForMatrix = useMemo(() => {
    if (!matrix?.courses?.length) return [];
    return matrix.courses.map((c) => ({
      ...c,
      coef: resolveCourseCoef(c.coef, programmeCoefByCourseId.get(c.id)),
    }));
  }, [matrix?.courses, programmeCoefByCourseId]);

  /** Aligné sur /academic/courses pour le programme de la classe (pas class_courses). */
  const excelCourses = useMemo(() => {
    if (coursesForMatrix.length) return coursesForMatrix;
    return programmeCoursesForClass.map((c) => ({
      id: c.id,
      code: c.code ?? "",
      name: c.name,
      coef: resolveCourseCoef(c.coef),
    }));
  }, [coursesForMatrix, programmeCoursesForClass]);

  const studentStats = useMemo(() => {
    if (!matrix) return {};
    const stats: Record<string, { total: number; average: number | null }> = {};
    for (const student of matrix.students) {
      let weightedTotal = 0;
      let coeffSum = 0;
      for (const course of coursesForMatrix) {
        const key = `${student.studentId}::${course.id}`;
        const parsed = parseGradeCell(draftMatrix[key]);
        if (parsed != null) {
          const coef = course.coef > 0 ? course.coef : 1;
          weightedTotal += parsed * coef;
          coeffSum += coef;
        }
      }
      stats[student.studentId] = {
        total: weightedTotal,
        average: coeffSum > 0 ? weightedTotal / coeffSum : null,
      };
    }
    return stats;
  }, [matrix, coursesForMatrix, draftMatrix]);

  const rankingByStudent = useMemo(() => {
    if (!matrix) return {};
    const withAvg = matrix.students
      .map((student) => ({
        studentId: student.studentId,
        avg: studentStats[student.studentId]?.average,
      }))
      .filter((row): row is { studentId: string; avg: number } => row.avg != null)
      .sort((a, b) => b.avg - a.avg);
    const ranks: Record<string, number | "NC"> = {};
    for (const s of matrix.students) {
      ranks[s.studentId] = "NC";
    }
    withAvg.forEach((item, index) => {
      ranks[item.studentId] = index + 1;
    });
    return ranks;
  }, [matrix, studentStats]);

  const filteredStudents = useMemo(() => {
    if (!matrix) return [];
    const q = studentSearch
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (!q) return matrix.students;
    return matrix.students.filter((s) => {
      const fullName = `${s.lastName ?? ""} ${s.firstName ?? ""}`
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return fullName.includes(q);
    });
  }, [matrix, studentSearch]);

  const handleSaveMatrix = async () => {
    if (!classId || !periodId || !matrix) return;
    const cells: { studentId: string; courseId: string; average: number | null }[] = [];
    for (const student of matrix.students) {
      for (const course of coursesForMatrix) {
        const key = `${student.studentId}::${course.id}`;
        const raw = draftMatrix[key]?.trim() ?? "";
        if (raw === "") {
          cells.push({ studentId: student.studentId, courseId: course.id, average: null });
          continue;
        }
        const n = parseGradeCell(raw);
        if (n === null) {
          const fullName = `${student.lastName ?? ""} ${student.firstName ?? ""}`.trim();
          toast.error(`Moyenne invalide pour ${fullName} (${course.code})`);
          return;
        }
        cells.push({ studentId: student.studentId, courseId: course.id, average: n });
      }
    }
    const attendance: { studentId: string; absenceHours: number | null; justifiedHours: number | null }[] = [];
    for (const student of matrix.students) {
      const row = draftAttendance[student.studentId] || { absenceHours: "", justifiedHours: "" };
      const absenceHours = parseHourCell(row.absenceHours);
      const justifiedHours = parseHourCell(row.justifiedHours);

      if (row.absenceHours.trim() !== "" && absenceHours === null) {
        const fullName = `${student.lastName ?? ""} ${student.firstName ?? ""}`.trim();
        toast.error(`Heures d'absence invalides pour ${fullName}`);
        return;
      }
      if (row.justifiedHours.trim() !== "" && justifiedHours === null) {
        const fullName = `${student.lastName ?? ""} ${student.firstName ?? ""}`.trim();
        toast.error(`Heures justifiées invalides pour ${fullName}`);
        return;
      }
      if ((justifiedHours ?? 0) > (absenceHours ?? 0)) {
        const fullName = `${student.lastName ?? ""} ${student.firstName ?? ""}`.trim();
        toast.error(`Heures justifiées supérieures aux heures d'absence pour ${fullName}`);
        return;
      }
      attendance.push({ studentId: student.studentId, absenceHours, justifiedHours });
    }

    try {
      await saveMatrix.mutateAsync({ classId, periodId, cells, attendance });
      toast.success("Moyennes et assiduité enregistrées");
      matrixDraftContextRef.current = "";
      await matrixQuery.refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement");
    }
  };

  const buildExcel = () => {
    const m = matrixQuery.data?.data;
    if (!m || !classId || !periodId) {
      toast.error("Chargez d'abord les données (classe et période)");
      return;
    }
    if (excelCourses.length === 0) {
      toast.error("Aucune matière trouvée pour cette classe");
      return;
    }
    const header = [
      "CODE",
      "NOM ET PRENOMS",
      ...excelCourses.map((c) => c.code),
      "TOT_",
      "MOYG_",
      "Rang_",
    ];
    const rows = m.students.map((s) => {
      const fullName = `${s.lastName ?? ""} ${s.firstName ?? ""}`.trim();
      const vals = excelCourses.map((c) => {
        const v = m.averages[s.studentId]?.[c.id];
        return v !== undefined && v !== null ? v : "";
      });
      return [s.studentNumber ?? "", fullName, ...vals, "", "", ""];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Moyennes");
    const safe = (m.className || "classe").replace(/[\\/:*?"<>|]/g, "-");
    XLSX.writeFile(wb, `moyennes-${safe}-${m.periodName || "periode"}.xlsx`);
    toast.success("Fichier téléchargé — complétez les colonnes matières puis importez");
  };

  const onImportExcel = async (file: File | null) => {
    if (!file || !classId || !periodId) return;
    const m = matrixQuery.data?.data;
    if (!m) {
      toast.error("Données matrice non chargées — sélectionnez classe et période");
      return;
    }
    if (excelCourses.length === 0) {
      toast.error("Aucune matière trouvée pour cette classe");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
      if (!raw.length) {
        toast.error("Fichier vide");
        return;
      }
      const headerRow = (raw[0] as unknown[]).map((h) => String(h).trim());
      const cells: { studentId: string; courseId: string; average: number | null }[] = [];

      for (let r = 1; r < raw.length; r++) {
        const row = raw[r] as unknown[];
        const code = String(row[0] ?? "").trim();
        if (!code) continue;
        const student = m.students.find((s) => String(s.studentNumber ?? "").trim() === code);
        if (!student) continue;

        for (const course of excelCourses) {
          const colIdx = headerRow.findIndex((h) => h === course.code);
          if (colIdx < 0) continue;
          const rawCell = row[colIdx];
          const trimmed = String(rawCell ?? "").trim();
          if (trimmed === "") {
            cells.push({ studentId: student.studentId, courseId: course.id, average: null });
            continue;
          }
          const val = parseGradeCell(rawCell);
          if (val !== null) {
            cells.push({ studentId: student.studentId, courseId: course.id, average: val });
          }
        }
      }

      if (cells.length === 0) {
        toast.error("Aucune moyenne reconnue — vérifiez les codes matières (ligne 1) et les codes élèves (colonne A)");
        return;
      }

      const attendance = m.students.map((student) => {
        const row = draftAttendance[student.studentId] || { absenceHours: "", justifiedHours: "" };
        return {
          studentId: student.studentId,
          absenceHours: parseHourCell(row.absenceHours),
          justifiedHours: parseHourCell(row.justifiedHours),
        };
      });

      await saveMatrix.mutateAsync({ classId, periodId, cells, attendance });
      toast.success(`${cells.length} cellule(s) synchronisée(s) depuis le fichier`);
      /** Sans ça, l'effet brouillon ne reapplique pas les moyennes (même ctx classe/période/cours). */
      matrixDraftContextRef.current = "";
      await matrixQuery.refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Import impossible");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      toast.error("Impossible de basculer en plein écran");
    }
  };

  const handleGenerateAttendanceCertificates = async () => {
    if (!classId || !periodId) {
      toast.error("Sélectionnez d'abord une classe et une période");
      return;
    }
    try {
      setIsGeneratingCertificates(true);
      const { blob } = await generateAttendanceCertificatesPdf(classId, periodId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      // Let the new tab load the blob before releasing it.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Attestations générées — ouverture dans un nouvel onglet");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la génération des attestations");
    } finally {
      setIsGeneratingCertificates(false);
    }
  };

  const handleGenerateAttendanceCertificatesHtml = async () => {
    if (!classId || !periodId) {
      toast.error("Selectionnez d'abord une classe et une periode");
      return;
    }
    try {
      setIsGeneratingHtmlCertificates(true);
      const { blob } = await generateAttendanceCertificatesHtmlPdf(classId, periodId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Attestations HTML generees dans un nouvel onglet");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la generation HTML des attestations");
    } finally {
      setIsGeneratingHtmlCertificates(false);
    }
  };

  const handleGenerateSingleAttendanceCertificateHtml = async (studentId: string) => {
    if (!classId || !periodId) {
      toast.error("Selectionnez d'abord une classe et une periode");
      return;
    }
    try {
      setGeneratingStudentId(studentId);
      const { blob } = await generateAttendanceCertificatesHtmlPdf(classId, periodId, studentId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Attestation generee dans un nouvel onglet");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la generation de l'attestation");
    } finally {
      setGeneratingStudentId(null);
    }
  };

  const handleGenerateReportCards = async () => {
    if (!classId || !periodId) {
      toast.error("Selectionnez d'abord une classe et une periode");
      return;
    }
    try {
      setIsGeneratingReportCards(true);
      const { blob } = await generateReportCardsPdf(classId, periodId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Bulletins generes dans un nouvel onglet");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la generation des bulletins");
    } finally {
      setIsGeneratingReportCards(false);
    }
  };

  const handleGenerateSingleReportCard = async (studentId: string) => {
    if (!classId || !periodId) {
      toast.error("Selectionnez d'abord une classe et une periode");
      return;
    }
    try {
      setGeneratingReportCardStudentId(studentId);
      const { blob } = await generateReportCardsPdf(classId, periodId, studentId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success("Bulletin genere dans un nouvel onglet");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la generation du bulletin");
    } finally {
      setGeneratingReportCardStudentId(null);
    }
  };

  if (loadingYear) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-muted-foreground">Chargement…</p>
      </div>
    );
  }

  if (!activeYear) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-orange-800">Aucune année académique active</CardTitle>
            <CardDescription>
              Définissez une année active depuis « Démarrer Année » avant de saisir les moyennes.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className={`container mx-auto px-4 py-8 ${isFullscreen ? "max-w-none" : "max-w-6xl"}`}>
      <div className="mb-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
              <Table2 className="h-8 w-8" />
              Moyennes par semestre
            </h1>
            <p className="text-muted-foreground">
              Saisissez les moyennes sur 20 par matière et par période (semestre ou trimestre). Année active :{" "}
              <span className="font-medium text-foreground">{activeYear.name}</span>
            </p>
          </div>
          <Button type="button" variant="outline" className="gap-2 shrink-0" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {isFullscreen ? "Quitter le plein écran" : "Plein écran"}
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Période et classe</CardTitle>
          <CardDescription>Choisissez le semestre / trimestre et la classe (commun aux deux modes).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Semestre / trimestre</Label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Choisir une période" />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {periods.length === 0 && (
              <p className="text-sm text-orange-700 mt-2">
                Aucune période pour cette année — ajoutez des semestres dans « Démarrer Année ».
              </p>
            )}
          </div>
          <div>
            <Label>Classe</Label>
            <Select value={classId} onValueChange={setClassId} disabled={loadingClasses}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Choisir une classe" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Documents scolaires</CardTitle>
          <CardDescription>
            Générez les attestations et les bulletins en un clic pour la classe et la période sélectionnées.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className="hidden"
              onClick={() => void handleGenerateAttendanceCertificates()}
              disabled={!classId || !periodId || isGeneratingCertificates || isGeneratingHtmlCertificates || isGeneratingReportCards}
            >
              <FileText className="h-4 w-4" />
              {isGeneratingCertificates ? "Génération Word en cours..." : "Générer les attestations (modèle Word)"}
            </Button>
            <Button
              type="button"
              className="gap-2"
              onClick={() => void handleGenerateAttendanceCertificatesHtml()}
              disabled={!classId || !periodId || isGeneratingHtmlCertificates || isGeneratingCertificates || isGeneratingReportCards}
            >
              <FileText className="h-4 w-4" />
              {isGeneratingHtmlCertificates ? "Génération HTML en cours..." : "Générer les attestations"}
            </Button>
            <Button
              type="button"
              className="gap-2"
              onClick={() => void handleGenerateReportCards()}
              disabled={!classId || !periodId || isGeneratingReportCards || isGeneratingCertificates || isGeneratingHtmlCertificates}
            >
              <FileText className="h-4 w-4" />
              {isGeneratingReportCards ? "Génération des bulletins..." : "Générer les bulletins"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            Le PDF s&apos;ouvre dans un nouvel onglet pour impression ou telechargement.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="grille" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="grille">Grille de saisie</TabsTrigger>
          <TabsTrigger value="excel">Fichier Excel</TabsTrigger>
        </TabsList>

        <TabsContent value="grille" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Saisie des moyennes par matière</CardTitle>
              <CardDescription>
                Après sélection du semestre et de la classe, saisissez les moyennes de chaque élève pour toutes les matières,
                comme sur le tableau de référence.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {matrixQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Chargement des étudiants…</p>
              )}
              {matrixQuery.isError && (
                <p className="text-sm text-destructive">{(matrixQuery.error as Error).message}</p>
              )}

              {classId && periodId && matrix && matrix.students.length > 0 && matrix.courses.length > 0 && (
                <>
                  <div className="max-w-md">
                    <Label htmlFor="student-search">Rechercher par nom complet</Label>
                    <Input
                      id="student-search"
                      type="text"
                      placeholder="Ex: Kouame Nadia"
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <div className="rounded-lg border overflow-x-auto max-h-[70vh]">
                    <table className="w-full text-sm" data-testid="moyennes-matrix-table">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Action</th>
                          <th className="text-left p-3 font-medium">Code</th>
                          <th className="text-left p-3 font-medium">Nom et prenom</th>
                          {coursesForMatrix.map((course) => (
                            <th
                              key={course.id}
                              className="text-left p-3 font-medium min-w-[115px]"
                              title={`${course.name || course.code} (coef ${course.coef})`}
                            >
                              {course.code}
                            </th>
                          ))}
                          <th className="text-left p-3 font-medium min-w-[230px]">Assiduité (Abs./Just.)</th>
                          <th className="text-left p-3 font-medium">TOT_</th>
                          <th className="text-left p-3 font-medium">MOYG_</th>
                          <th className="text-left p-3 font-medium">Rang_</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStudents.map((s) => (
                          <tr key={s.studentId} className="border-b last:border-0 align-top">
                            <td className="p-3">
                              <div className="flex min-w-[200px] flex-row items-center gap-2 whitespace-nowrap">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="gap-2"
                                  onClick={() => void handleGenerateSingleAttendanceCertificateHtml(s.studentId)}
                                  disabled={
                                    generatingStudentId === s.studentId ||
                                    isGeneratingCertificates ||
                                    isGeneratingHtmlCertificates ||
                                    isGeneratingReportCards ||
                                    generatingReportCardStudentId === s.studentId
                                  }
                                >
                                  <FileText className="h-4 w-4" />
                                  {generatingStudentId === s.studentId ? "Generation..." : "Attestation"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="gap-2"
                                  onClick={() => void handleGenerateSingleReportCard(s.studentId)}
                                  disabled={
                                    generatingReportCardStudentId === s.studentId ||
                                    isGeneratingReportCards ||
                                    isGeneratingCertificates ||
                                    isGeneratingHtmlCertificates ||
                                    generatingStudentId === s.studentId
                                  }
                                >
                                  <FileText className="h-4 w-4" />
                                  {generatingReportCardStudentId === s.studentId ? "Generation..." : "Bulletin"}
                                </Button>
                              </div>
                            </td>
                            <td className="p-3 font-mono text-xs whitespace-nowrap">{s.studentNumber ?? "--"}</td>
                            <td className="p-3 whitespace-nowrap">
                              {s.lastName} {s.firstName}
                            </td>
                            {coursesForMatrix.map((course) => {
                              const key = `${s.studentId}::${course.id}`;
                              return (
                                <td key={course.id} className="p-2">
                                  <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    max={20}
                                    step={0.01}
                                    placeholder="--"
                                    value={draftMatrix[key] ?? ""}
                                    onChange={(e) =>
                                      setDraftMatrix((d) => ({
                                        ...d,
                                        [key]: sanitizeIntegerGradeInput(e.target.value),
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (["e", "E", "+", "-"].includes(e.key)) {
                                        e.preventDefault();
                                      }
                                    }}
                                    onPaste={(e) => {
                                      const pasted = e.clipboardData.getData("text");
                                      const sanitized = sanitizeIntegerGradeInput(pasted);
                                      if (sanitized !== pasted) {
                                        e.preventDefault();
                                        setDraftMatrix((d) => ({ ...d, [key]: sanitized }));
                                      }
                                    }}
                                    className="h-9 min-w-[100px]"
                                  />
                                </td>
                              );
                            })}
                            <td className="p-2">
                              <div className="grid grid-cols-2 gap-2 min-w-[220px]">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step={0.25}
                                  placeholder="Abs."
                                  value={draftAttendance[s.studentId]?.absenceHours ?? ""}
                                  onChange={(e) =>
                                    setDraftAttendance((d) => ({
                                      ...d,
                                      [s.studentId]: {
                                        absenceHours: sanitizeHourInput(e.target.value),
                                        justifiedHours: d[s.studentId]?.justifiedHours ?? "",
                                      },
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (["e", "E", "+", "-"].includes(e.key)) {
                                      e.preventDefault();
                                    }
                                  }}
                                  className="h-9"
                                />
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step={0.25}
                                  placeholder="Just."
                                  value={draftAttendance[s.studentId]?.justifiedHours ?? ""}
                                  onChange={(e) =>
                                    setDraftAttendance((d) => ({
                                      ...d,
                                      [s.studentId]: {
                                        absenceHours: d[s.studentId]?.absenceHours ?? "",
                                        justifiedHours: sanitizeHourInput(e.target.value),
                                      },
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (["e", "E", "+", "-"].includes(e.key)) {
                                      e.preventDefault();
                                    }
                                  }}
                                  className="h-9"
                                />
                              </div>
                            </td>
                            <td className="p-3 font-medium">
                              {formatFrFixed(studentStats[s.studentId]?.total ?? 0, 2)}
                            </td>
                            <td className="p-3 font-medium">
                              {studentStats[s.studentId]?.average != null
                                ? formatFrFixed(studentStats[s.studentId].average!, 2)
                                : "--"}
                            </td>
                            <td className="p-3 font-medium">
                              {rankingByStudent[s.studentId] === "NC"
                                ? "NC"
                                : `${rankingByStudent[s.studentId]}e`}
                            </td>
                          </tr>
                        ))}
                        {filteredStudents.length === 0 && (
                          <tr>
                            <td
                              className="p-3 text-sm text-muted-foreground"
                              colSpan={coursesForMatrix.length + 7}
                            >
                              Aucun élève trouvé pour cette recherche.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    onClick={() => void handleSaveMatrix()}
                    disabled={saveMatrix.isPending}
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    Enregistrer les moyennes et l&apos;assiduité
                  </Button>
                </>
              )}

              {classId && periodId && matrix?.students?.length === 0 && (
                <p className="text-muted-foreground text-sm">Aucun élève inscrit dans cette classe.</p>
              )}
              {classId && periodId && matrix?.courses?.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  Aucune matière pour le programme de cette classe (vérifiez le programme et la page Matières).
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="excel" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Modèle Excel</CardTitle>
              <CardDescription>
                Téléchargez un tableau prérempli (codes élèves et colonnes par code matière). Remplissez les moyennes sur 20,
                puis importez le fichier. Les colonnes TOT_, MOYG_, Rang_ sont optionnelles (non lues à l&apos;import).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {matrixQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
              {matrixQuery.isError && (
                <p className="text-sm text-destructive">{(matrixQuery.error as Error).message}</p>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="default"
                  className="gap-2"
                  onClick={buildExcel}
                  disabled={!classId || !periodId || matrixQuery.isLoading || !matrixQuery.data}
                >
                  <FileDown className="h-4 w-4" />
                  Télécharger le modèle Excel
                </Button>
                <input
                  ref={excelFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    void onImportExcel(f ?? null);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => excelFileRef.current?.click()}
                  disabled={!classId || !periodId}
                >
                  <FileUp className="h-4 w-4" />
                  Importer un fichier rempli
                </Button>
              </div>

              {matrixQuery.data?.data && (
                <p className="text-sm text-muted-foreground">
                  {matrixQuery.data.data.students.length} étudiant(s), {excelCourses.length} matière(s) —{" "}
                  {matrixQuery.data.data.periodName}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
