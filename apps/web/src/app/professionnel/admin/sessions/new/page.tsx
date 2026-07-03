"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, Layers, CalendarRange, Info, UserCog } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import {
  useProfessionalSemestre,
  useProfessionalSemestres,
  useCreateSessionsBySemestre,
} from "@/lib/hooks/use-professional-semestres";
import { useTeachers } from "@/lib/hooks/use-teachers";

/**
 * Création de sessions par semestre — Module Professionnel.
 *
 * Pour chaque semestre choisi, on crée une session par UE, datée et rattachée au
 * semestre. À la création, on affiche toutes les UE du semestre et, pour chaque
 * UE, ses ECUE afin d'affecter un enseignant en même temps.
 * Portée : un semestre ou toute la filière.
 */

const LIST_URL = "/professionnel/admin/sessions";
const NONE = "__none__";

type Scope = "one" | "all";

interface BlockData {
  libelle: string;
  date_debut: string;
  date_fin: string;
}

const emptyBlock = (semLibelle: string): BlockData => ({
  libelle: `Session ${semLibelle.replace(/semestre\s*/i, "").trim()}`,
  date_debut: "",
  date_fin: "",
});

function teacherLabel(t: any): string {
  const name = `${t.firstName ?? t.first_name ?? ""} ${t.lastName ?? t.last_name ?? ""}`.trim();
  return name || t.email || t.id;
}

/** Bloc d'un semestre : champs de dates + UE/ECUE avec affectation enseignant. */
function SemestreBlockCard({
  semestre,
  block,
  onBlock,
  teachers,
  selections,
  onTeacher,
}: {
  semestre: any;
  block: BlockData;
  onBlock: (patch: Partial<BlockData>) => void;
  teachers: any[];
  selections: Record<string, string>;
  onTeacher: (ecueId: string, teacherId: string) => void;
}) {
  const detailQuery = useProfessionalSemestre(semestre.id);
  const ues: any[] = detailQuery.data?.ues ?? [];

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-indigo-600" />
            {semestre.libelle}
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {semestre.nb_ue ?? 0} UE · {semestre.nb_uv ?? 0} crédits
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Champs de la session */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Libellé des sessions</label>
          <Input
            value={block.libelle}
            onChange={(e) => onBlock({ libelle: e.target.value })}
            placeholder="Ex. : Session Janvier 2026"
          />
          <p className="text-xs text-muted-foreground">
            Le code de chaque UE est ajouté automatiquement (ex. « {block.libelle || "Session"} —
            UE-CODE »).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Date de début</label>
            <Input
              type="date"
              value={block.date_debut}
              onChange={(e) => onBlock({ date_debut: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Date de fin</label>
            <Input
              type="date"
              value={block.date_fin}
              onChange={(e) => onBlock({ date_fin: e.target.value })}
            />
          </div>
        </div>

        {/* UE et ECUE avec affectation des enseignants */}
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <UserCog className="h-4 w-4 text-indigo-600" />
            UE et affectation des enseignants par ECUE
          </h3>

          {detailQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement des UE…
            </div>
          ) : ues.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune UE dans ce semestre.</p>
          ) : (
            <div className="space-y-4">
              {ues.map((u) => {
                const ecues: any[] = u.ecues ?? [];
                return (
                  <div key={u.id} className="rounded-lg border">
                    <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-2 border-b rounded-t-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs text-muted-foreground">{u.code}</span>
                        <span className="font-medium">{u.libelle}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {u.nb_uv ?? 0} crédits
                      </span>
                    </div>
                    {ecues.length === 0 ? (
                      <p className="text-sm text-muted-foreground px-3 py-2">
                        Aucune ECUE rattachée à cette UE.
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                          <tr>
                            <th className="py-2 px-3">ECUE</th>
                            <th className="py-2 pr-3 w-72">Enseignant</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ecues.map((ec) => (
                            <tr key={ec.ecue_id} className="border-b last:border-0">
                              <td className="py-2 px-3">
                                <span className="font-mono text-xs">{ec.ecue_code}</span>{" "}
                                {ec.ecue_libelle}
                              </td>
                              <td className="py-2 pr-3">
                                {ec.is_conduite ? (
                                  <span className="text-xs text-muted-foreground italic">
                                    Note de conduite — pas d'enseignant
                                  </span>
                                ) : (
                                  <SearchableSelect
                                    value={selections[ec.ecue_id] ?? NONE}
                                    onChange={(v) => onTeacher(ec.ecue_id, v)}
                                    placeholder="Non affecté"
                                    searchPlaceholder="Rechercher un enseignant…"
                                    options={[
                                      { value: NONE, label: "— Non affecté —" },
                                      ...teachers.map((t) => ({
                                        value: t.id,
                                        label: teacherLabel(t),
                                      })),
                                    ]}
                                  />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function NewProfessionalSessionPage() {
  const router = useRouter();
  const [filiereId, setFiliereId] = useState<string>("");
  const [scope, setScope] = useState<Scope>("one");
  const [oneSemestreId, setOneSemestreId] = useState<string>("");
  const [blocks, setBlocks] = useState<Record<string, BlockData>>({});
  // Affectations : { [semestreId]: { [ecueId]: teacherId } }.
  const [teacherSel, setTeacherSel] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const programmesQuery = useProgrammes();
  const semestresQuery = useProfessionalSemestres(filiereId ? { filiere_id: filiereId } : {});
  const teachersQuery = useTeachers({ limit: 100 });
  const createMut = useCreateSessionsBySemestre();

  const filieres: any[] = programmesQuery.data?.data ?? [];
  const teachers: any[] = (teachersQuery.data as any)?.data ?? [];
  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any[]) ?? [];
    return filiereId
      ? [...list].sort((a, b) => String(a.libelle).localeCompare(String(b.libelle)))
      : [];
  }, [semestresQuery.data, filiereId]);

  const targetSemestres = useMemo(() => {
    if (!filiereId) return [];
    if (scope === "all") return semestres;
    return oneSemestreId ? semestres.filter((s) => s.id === oneSemestreId) : [];
  }, [filiereId, scope, oneSemestreId, semestres]);

  useEffect(() => {
    setBlocks((prev) => {
      const next = { ...prev };
      for (const s of targetSemestres) if (!next[s.id]) next[s.id] = emptyBlock(s.libelle);
      return next;
    });
  }, [targetSemestres]);

  function selectFiliere(id: string) {
    setFiliereId(id);
    setOneSemestreId("");
    setBlocks({});
    setTeacherSel({});
  }

  function setBlockField(semId: string, patch: Partial<BlockData>) {
    setBlocks((prev) => ({ ...prev, [semId]: { ...prev[semId], ...patch } }));
  }

  function setTeacher(semId: string, ecueId: string, teacherId: string) {
    setTeacherSel((prev) => ({
      ...prev,
      [semId]: { ...(prev[semId] ?? {}), [ecueId]: teacherId },
    }));
  }

  const saving = createMut.isPending;
  const totalUe = targetSemestres.reduce((a, s) => a + (s.nb_ue ?? 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!filiereId) return setError("Veuillez sélectionner une filière.");
    if (targetSemestres.length === 0)
      return setError(
        scope === "one" ? "Veuillez sélectionner un semestre." : "Cette filière n'a aucun semestre."
      );

    const payloadBlocks = [];
    for (const s of targetSemestres) {
      const b = blocks[s.id];
      if (!b) continue;
      if (!b.libelle.trim()) return setError(`Libellé manquant pour « ${s.libelle} ».`);
      if (!b.date_debut || !b.date_fin)
        return setError(`Dates manquantes pour « ${s.libelle} ».`);
      if (b.date_fin < b.date_debut)
        return setError(`Pour « ${s.libelle} », la date de fin doit suivre la date de début.`);

      const sel = teacherSel[s.id] ?? {};
      const ecue_teachers = Object.entries(sel)
        .filter(([, tid]) => tid && tid !== NONE)
        .map(([ecue_id, enseignant_id]) => ({ ecue_id, enseignant_id }));

      payloadBlocks.push({
        semestre_id: s.id,
        libelle: b.libelle.trim(),
        date_debut: b.date_debut,
        date_fin: b.date_fin,
        inscription_ouverte_le: new Date(`${b.date_debut}T00:00:00`).toISOString(),
        inscription_fermee_le: new Date(`${b.date_fin}T23:59:59`).toISOString(),
        capacite_max: null,
        // À la création, une session est toujours ouverte aux inscriptions.
        statut: "ouvert" as const,
        ...(ecue_teachers.length > 0 ? { ecue_teachers } : {}),
      });
    }

    try {
      await createMut.mutateAsync({ filiere_id: filiereId, blocks: payloadBlocks });
      router.push(LIST_URL);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la création des sessions.");
    }
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push(LIST_URL)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            Nouvelles sessions
          </h1>
          <p className="text-muted-foreground mt-2">
            Créez les sessions d'un semestre ou de toute une filière, et affectez les enseignants
            par ECUE en même temps.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto w-full">
        {/* Filière + portée */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Filière et portée</CardTitle>
            <CardDescription>
              Un étudiant peut s'inscrire à un seul semestre ou à toute la filière.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Filière</label>
              <SearchableSelect
                value={filiereId}
                onChange={selectFiliere}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder={
                  programmesQuery.isLoading ? "Chargement…" : "Sélectionner une filière"
                }
                options={filieres.map((f) => ({
                  value: f.id,
                  label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
                }))}
              />
            </div>

            {filiereId && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Portée</label>
                  <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one">Un semestre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {scope === "one" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Semestre</label>
                    <SearchableSelect
                      value={oneSemestreId}
                      onChange={setOneSemestreId}
                      icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
                      placeholder={
                        semestresQuery.isLoading
                          ? "Chargement…"
                          : semestres.length === 0
                          ? "Aucun semestre"
                          : "Sélectionner un semestre"
                      }
                      options={semestres.map((s) => ({
                        value: s.id,
                        label: `${s.libelle} · ${s.nb_ue ?? 0} UE`,
                      }))}
                    />
                  </div>
                )}
              </div>
            )}

            {filiereId && targetSemestres.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                {targetSemestres.length} semestre{targetSemestres.length > 1 ? "s" : ""} ·{" "}
                {totalUe} session{totalUe > 1 ? "s" : ""} seront créées (une par UE).
              </p>
            )}
          </CardContent>
        </Card>

        {/* Un bloc par semestre ciblé */}
        {targetSemestres.map((s) => (
          <SemestreBlockCard
            key={s.id}
            semestre={s}
            block={blocks[s.id] ?? emptyBlock(s.libelle)}
            onBlock={(patch) => setBlockField(s.id, patch)}
            teachers={teachers}
            selections={teacherSel[s.id] ?? {}}
            onTeacher={(ecueId, teacherId) => setTeacher(s.id, ecueId, teacherId)}
          />
        ))}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(LIST_URL)}
            disabled={saving}
          >
            Annuler
          </Button>
          <Button type="submit" disabled={saving || targetSemestres.length === 0}>
            {saving ? (
              <span className="flex items-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enregistrement…
              </span>
            ) : (
              `Créer ${totalUe > 0 ? `${totalUe} ` : ""}session${totalUe > 1 ? "s" : ""}`
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
