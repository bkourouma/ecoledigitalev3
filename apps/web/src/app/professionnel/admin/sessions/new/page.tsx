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
} from "@ecoledigitale/ui";
import { ArrowLeft, Loader2, Layers, CalendarRange, Info, UserCog, Tag, Check } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useProgrammes } from "@/lib/hooks/use-programmes";
import {
  useProfessionalSemestre,
  useProfessionalSemestres,
  useCreateSessionsBySemestre,
  useClasseNoms,
  useDeclareClasseNom,
  type ClasseNomOuvert,
} from "@/lib/hooks/use-professional-semestres";
import { useTeachers } from "@/lib/hooks/use-teachers";

/**
 * Création de classes par semestre — Module Professionnel.
 *
 * Pour le semestre choisi, on crée une classe par UE, datée et rattachée au
 * semestre. À la création, on affiche toutes les UE du semestre et, pour chaque
 * UE, ses ECUE afin d'affecter un enseignant en même temps.
 */

const LIST_URL = "/professionnel/admin/sessions";
const NONE = "__none__";

interface BlockData {
  date_debut: string;
  date_fin: string;
}

/** Le nom de la classe est commun à tous les semestres ouverts d'un coup. */
const emptyBlock = (): BlockData => ({ date_debut: "", date_fin: "" });


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
        {/* Période de la classe */}
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
  const [nomClasse, setNomClasse] = useState<string>("");
  const [semestreId, setSemestreId] = useState<string>("");
  // Portée choisie pour un nom neuf : les semestres qu'il couvrira.
  const [porteeIds, setPorteeIds] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Record<string, BlockData>>({});
  // Affectations : { [semestreId]: { [ecueId]: teacherId } }.
  const [teacherSel, setTeacherSel] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const programmesQuery = useProgrammes();
  const semestresQuery = useProfessionalSemestres(filiereId ? { filiere_id: filiereId } : {});
  const teachersQuery = useTeachers({ limit: 100 });
  const createMut = useCreateSessionsBySemestre();
  const nomsQuery = useClasseNoms(filiereId || null);
  const declareMut = useDeclareClasseNom();

  const filieres: any[] = programmesQuery.data?.data ?? [];
  const teachers: any[] = (teachersQuery.data as any)?.data ?? [];
  const semestres: any[] = useMemo(() => {
    const list = (semestresQuery.data as any[]) ?? [];
    return filiereId
      ? [...list].sort((a, b) => String(a.libelle).localeCompare(String(b.libelle)))
      : [];
  }, [semestresQuery.data, filiereId]);


  // Noms déjà utilisés pour cette classe. Un nom dont tous les semestres sont
  // ouverts est bouclé : il ne sert plus à rien de le proposer.
  const nomsEnCours: ClasseNomOuvert[] = useMemo(
    () => (nomsQuery.data?.noms ?? []).filter((n) => !n.complet),
    [nomsQuery.data]
  );

  // Semestres déjà ouverts pour le nom saisi : on ne les propose plus.
  const nomCourant = useMemo(
    () => (nomsQuery.data?.noms ?? []).find((n) => n.nom === nomClasse.trim()) ?? null,
    [nomsQuery.data, nomClasse]
  );
  const semestresDejaOuverts = useMemo(
    () => new Set((nomCourant?.semestres_ouverts ?? []).map((sm) => sm.id)),
    [nomCourant]
  );

  const targetSemestres = useMemo(
    () => (filiereId && semestreId ? semestres.filter((s) => s.id === semestreId) : []),
    [filiereId, semestreId, semestres]
  );

  // Le semestre à ouvrir se choisit dans la portée cochée, moins ce qui est
  // déjà ouvert sous ce nom.
  const semestresDisponibles = useMemo(() => {
    const portee = nomClasse.trim()
      ? semestres.filter((sm) => porteeIds.includes(sm.id))
      : semestres;
    return portee.filter((sm) => !semestresDejaOuverts.has(sm.id));
  }, [nomClasse, porteeIds, semestres, semestresDejaOuverts]);

  // Le nom choisi impose sa portée de départ : celle déjà déclarée s'il
  // existe, les trois semestres s'il est neuf. Les modifications de
  // l'utilisateur ne sont pas écrasées : cet effet ne rejoue que si le nom
  // change, ou si la portée enregistrée change.
  useEffect(() => {
    if (!filiereId || semestres.length === 0) return;
    if (nomCourant) {
      setPorteeIds(nomCourant.semestres_portee.map((sm) => sm.id));
    } else if (nomClasse.trim()) {
      setPorteeIds(semestres.map((sm) => sm.id));
    } else {
      setPorteeIds([]);
    }
  }, [filiereId, nomClasse, nomCourant, semestres]);

  // Un semestre déjà ouvert ne peut pas sortir de la portée : la déclaration
  // contredirait les ouvertures existantes.
  function togglePortee(id: string) {
    if (semestresDejaOuverts.has(id)) return;
    setPorteeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // Portée modifiée par rapport à ce qui est enregistré.
  const porteeModifiee = useMemo(() => {
    if (!nomCourant) return false;
      const avant = nomCourant.semestres_portee.map((sm) => sm.id).sort().join("|");
      const apres = [...porteeIds].sort().join("|");
    return avant !== apres;
  }, [nomCourant, porteeIds]);

  async function enregistrerPortee() {
    if (!filiereId || !nomClasse.trim() || porteeIds.length === 0) return;
    setError(null);
    try {
      await declareMut.mutateAsync({
        classeId: filiereId,
        nom: nomClasse.trim(),
        semestreIds: porteeIds,
      });
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de l'enregistrement de la portée.");
    }
  }

  useEffect(() => {
    setBlocks((prev) => {
      const next = { ...prev };
      for (const s of targetSemestres) if (!next[s.id]) next[s.id] = emptyBlock();
      return next;
    });
  }, [targetSemestres]);

  // Changer de nom ou de portée peut rendre le semestre choisi invalide.
  useEffect(() => {
    setSemestreId((prev) =>
      prev && !semestresDisponibles.some((sm) => sm.id === prev) ? "" : prev
    );
  }, [semestresDisponibles]);

  function selectFiliere(id: string) {
    setFiliereId(id);
    setNomClasse("");
    setSemestreId("");
    setPorteeIds([]);
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
    if (!filiereId) return setError("Veuillez sélectionner une classe.");
    if (!nomClasse.trim()) return setError("Veuillez saisir le nom de la classe.");
    if (targetSemestres.length === 0) return setError("Veuillez sélectionner un semestre.");
    if (porteeIds.length === 0)
      return setError("Veuillez cocher les semestres que ce nom couvrira.");

    const payloadBlocks = [];
    for (const s of targetSemestres) {
      const b = blocks[s.id];
      if (!b) continue;
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
        libelle: nomClasse.trim(),
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
      // La portée cochée est enregistrée à chaque ouverture : elle vaut aussi
      // bien déclaration initiale que correction. Un échec ici ne remet pas en
      // cause l'ouverture créée.
      if (porteeIds.length > 0) {
        try {
          await declareMut.mutateAsync({
            classeId: filiereId,
            nom: nomClasse.trim(),
            semestreIds: porteeIds,
          });
        } catch {}
      }
      router.push(LIST_URL);
    } catch (err: any) {
      setError(err?.message ?? "Erreur lors de la création des classes.");
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
            Ouvrir une classe
          </h1>
          <p className="text-muted-foreground mt-2">
            Ouvrez une classe sur un semestre et affectez les enseignants par ECUE en même temps.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl mx-auto w-full">
        {/* Classe + semestre */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Classe, nom et semestre</CardTitle>
            <CardDescription>
              Un nom de classe se poursuit d&apos;un semestre à l&apos;autre : reprenez
              celui d&apos;une ouverture précédente, ou saisissez-en un nouveau.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Classe</label>
              <SearchableSelect
                value={filiereId}
                onChange={selectFiliere}
                icon={<Layers className="h-4 w-4 text-gray-400" />}
                placeholder={
                  programmesQuery.isLoading ? "Chargement…" : "Sélectionner une classe"
                }
                options={filieres.map((f) => ({
                  value: f.id,
                  label: `${f.name}${f.code ? ` (${f.code})` : ""}`,
                }))}
              />
            </div>

            {filiereId && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nom de la classe</label>
                <Input
                  value={nomClasse}
                  onChange={(e) => setNomClasse(e.target.value)}
                  placeholder="Ex. : LICENCE 1 TRANSPORT LOGISTIQUE"
                />

                {/* Noms commencés mais pas encore bouclés : un clic les reprend. */}
                {nomsEnCours.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs text-muted-foreground">
                      Noms déjà commencés pour cette classe :
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {nomsEnCours.map((n) => {
                        const actif = n.nom === nomClasse.trim();
                        return (
                          <button
                            key={n.nom}
                            type="button"
                            onClick={() => setNomClasse(n.nom)}
                            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
                              actif
                                ? "border-indigo-500 bg-indigo-500/10 text-indigo-500"
                                : "border-input hover:bg-accent hover:text-accent-foreground"
                            }`}
                            title={`Reste : ${n.semestres_restants
                              .map((sm) => sm.libelle)
                              .join(", ")}`}
                          >
                            <Tag className="h-3 w-3 shrink-0" />
                            <span>{n.nom}</span>
                            <span className="text-muted-foreground">
                              {n.semestres_portee.length - n.semestres_restants.length}/
                              {n.semestres_portee.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Portée du nom : modifiable tant qu'un semestre n'est pas ouvert. */}
            {filiereId && nomClasse.trim() && semestres.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium">
                    {nomCourant
                      ? "Semestres couverts par ce nom"
                      : "Ce nom sera utilisé pour"}
                  </label>
                  {porteeModifiee && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={enregistrerPortee}
                      disabled={declareMut.isPending || porteeIds.length === 0}
                    >
                      {declareMut.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      Enregistrer la portée
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {semestres.map((sm) => {
                    const coche = porteeIds.includes(sm.id);
                    const verrouille = semestresDejaOuverts.has(sm.id);
                    return (
                      <button
                        key={sm.id}
                        type="button"
                        disabled={verrouille}
                        onClick={() => togglePortee(sm.id)}
                        title={
                          verrouille
                            ? "Déjà ouvert sous ce nom : ne peut plus sortir de la portée"
                            : undefined
                        }
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          verrouille
                            ? "cursor-not-allowed border-input bg-muted text-muted-foreground"
                            : coche
                              ? "border-indigo-500 bg-indigo-500/10 text-indigo-500"
                              : "border-input hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            coche
                              ? verrouille
                                ? "border-muted-foreground bg-muted-foreground text-background"
                                : "border-indigo-500 bg-indigo-500 text-white"
                              : "border-input"
                          }`}
                        >
                          {coche && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{sm.libelle}</span>
                          {verrouille && (
                            <span className="block text-xs text-muted-foreground">
                              déjà ouvert
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Le nom disparaîtra de la liste une fois ces semestres ouverts.
                </p>
              </div>
            )}

            {filiereId && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Semestre</label>
                <SearchableSelect
                  value={semestreId}
                  onChange={setSemestreId}
                  icon={<CalendarRange className="h-4 w-4 text-gray-400" />}
                  placeholder={
                    semestresQuery.isLoading
                      ? "Chargement…"
                      : semestresDisponibles.length === 0
                        ? "Tous les semestres sont déjà ouverts pour ce nom"
                        : "Sélectionner un semestre"
                  }
                  searchPlaceholder="Rechercher un semestre…"
                  options={semestresDisponibles.map((sm) => ({
                    value: sm.id,
                    label: `${sm.libelle} · ${sm.nb_ue ?? 0} UE`,
                  }))}
                />
                {nomCourant && (
                  <p className="text-xs text-muted-foreground">
                    Ce nom couvre{" "}
                    {nomCourant.semestres_portee.map((sm) => sm.libelle).join(", ")}.
                    {nomCourant.semestres_ouverts.length > 0 && (
                      <>
                        {" "}Déjà ouvert :{" "}
                        {nomCourant.semestres_ouverts.map((sm) => sm.libelle).join(", ")}.
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            {filiereId && targetSemestres.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                {targetSemestres.length} semestre{targetSemestres.length > 1 ? "s" : ""} ·{" "}
                {totalUe} classe{totalUe > 1 ? "s" : ""} seront créées (une par UE).
              </p>
            )}
          </CardContent>
        </Card>

        {/* Un bloc par semestre ciblé */}
        {targetSemestres.map((s) => (
          <SemestreBlockCard
            key={s.id}
            semestre={s}
            block={blocks[s.id] ?? emptyBlock()}
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
              "Créer"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
