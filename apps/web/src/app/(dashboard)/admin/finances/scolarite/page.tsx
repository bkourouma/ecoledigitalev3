"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ecoledigitale/ui";
import { AlertCircle, BookOpen, Check, GraduationCap, Layers, Loader2, Save } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useFilieres } from "@/lib/hooks/use-filieres";
import {
  useScolariteBareme,
  useUpsertScolarite,
  type ScolariteClasse,
} from "@/lib/hooks/use-scolarite-bareme";

/**
 * Scolarité — barème par filière.
 *
 * On choisit une filière, et chaque CLASSE de cette filière apparaît avec le
 * détail de ses semestres : la scolarité proposée est la somme des prix des UE
 * qui composent chaque semestre. Le champ Scolarité reste modifiable ;
 * inscription, frais annexes et autres frais sont saisis par l'utilisateur.
 *
 * Couleurs : ne PAS utiliser les variantes `dark:`. La palette sombre est portée
 * par `:root` dans globals.css, et il n'existe aucun bloc `.light` — l'interface
 * est donc sombre quel que soit le thème, alors que `dark:` ne s'active que si
 * ThemeProvider a posé la classe `dark`. Un `bg-<couleur>-50 dark:bg-<couleur>-950`
 * donne alors un fond clair sous un texte clair.
 */

/**
 * Référence stable pour les listes vides : un `[]` littéral recréé à chaque
 * rendu relancerait l'effet de (ré)initialisation du formulaire en boucle.
 */
const AUCUNE_CLASSE: ScolariteClasse[] = [];

/** Valeur des filtres cycle / classe quand aucun n'est appliqué. */
const TOUS = "all";

interface FraisForm {
  inscription: string;
  scolarite: string;
  annexes: string;
  autres: string;
}

const CHAMPS: { key: keyof FraisForm; label: string }[] = [
  { key: "inscription", label: "Inscription" },
  { key: "scolarite", label: "Scolarité" },
  { key: "annexes", label: "Frais annexes" },
  { key: "autres", label: "Autres frais" },
];

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatMontant(montant: number, currency: string): string {
  return `${new Intl.NumberFormat("fr-FR").format(montant)} ${currency}`;
}

/**
 * Valeurs initiales du formulaire d'une classe : ce qui est déjà enregistré
 * fait foi ; à défaut, la scolarité est pré-remplie avec la somme des UE.
 */
function seedForm(classe: ScolariteClasse): FraisForm {
  if (classe.fees) {
    return {
      inscription: String(classe.fees.inscription),
      scolarite: String(classe.fees.scolarite),
      annexes: String(classe.fees.annexes),
      autres: String(classe.fees.autres),
    };
  }

  return {
    inscription: "0",
    scolarite: String(classe.scolariteCalculee),
    annexes: "0",
    autres: "0",
  };
}

function seedForms(classes: ScolariteClasse[]): Record<string, FraisForm> {
  return Object.fromEntries(classes.map((classe) => [classe.programmeId, seedForm(classe)]));
}

export default function AdminScolaritePage() {
  const [filiereId, setFiliereId] = useState("");
  const [cycleFilter, setCycleFilter] = useState(TOUS);
  const [classeFilter, setClasseFilter] = useState(TOUS);
  const [forms, setForms] = useState<Record<string, FraisForm>>({});
  const [baseline, setBaseline] = useState<Record<string, FraisForm>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [enregistrees, setEnregistrees] = useState<Record<string, boolean>>({});

  const { data: filieresData, isLoading: filieresLoading } = useFilieres();
  const { data: baremeData, isLoading, error } = useScolariteBareme(filiereId);
  const upsert = useUpsertScolarite();

  const classes = baremeData ?? AUCUNE_CLASSE;

  // Chaque rechargement du barème (changement de filière, retour d'un
  // enregistrement) redonne sa référence au formulaire.
  useEffect(() => {
    const seeded = seedForms(classes);
    setForms(seeded);
    setBaseline(seeded);
  }, [classes]);

  // Le nom seul : le domaine rallongerait le libellé sans rien distinguer de plus.
  const filiereOptions = useMemo(
    () => (filieresData ?? []).map((f) => ({ value: f.id, label: f.name })),
    [filieresData]
  );

  // Les cycles proposés sont ceux que porte réellement la filière choisie.
  const cycleOptions = useMemo(() => {
    const cycles = new Map<string, string>();
    for (const classe of classes) cycles.set(classe.cycleId, classe.cycleName);
    return [
      { value: TOUS, label: "Tous les cycles" },
      ...[...cycles.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    ];
  }, [classes]);

  // La liste des classes se restreint au cycle choisi.
  const classesDuCycle = useMemo(
    () => classes.filter((c) => cycleFilter === TOUS || c.cycleId === cycleFilter),
    [classes, cycleFilter]
  );

  const classeOptions = useMemo(
    () => [
      { value: TOUS, label: "Toutes les classes" },
      ...classesDuCycle.map((c) => ({ value: c.programmeId, label: c.programmeName })),
    ],
    [classesDuCycle]
  );

  const classesAffichees = useMemo(
    () => classesDuCycle.filter((c) => classeFilter === TOUS || c.programmeId === classeFilter),
    [classesDuCycle, classeFilter]
  );

  // Changer de filière remet les deux filtres à zéro : les cycles et les
  // classes proposés ne sont plus les mêmes.
  useEffect(() => {
    setCycleFilter(TOUS);
    setClasseFilter(TOUS);
  }, [filiereId]);

  // Une classe sélectionnée puis exclue par le filtre de cycle ne doit pas
  // laisser la page vide sans explication.
  useEffect(() => {
    if (classeFilter === TOUS) return;
    if (!classesDuCycle.some((c) => c.programmeId === classeFilter)) {
      setClasseFilter(TOUS);
    }
  }, [classeFilter, classesDuCycle]);

  function majChamp(programmeId: string, champ: keyof FraisForm, valeur: string) {
    setForms((prev) => ({
      ...prev,
      [programmeId]: { ...prev[programmeId], [champ]: valeur },
    }));
    setEnregistrees((prev) => ({ ...prev, [programmeId]: false }));
  }

  async function enregistrer(classe: ScolariteClasse) {
    const form = forms[classe.programmeId];
    if (!form) return;

    setSavingId(classe.programmeId);
    setErreurs((prev) => ({ ...prev, [classe.programmeId]: "" }));

    try {
      await upsert.mutateAsync({
        cycleId: classe.cycleId,
        programmeId: classe.programmeId,
        inscription: toNumber(form.inscription),
        scolarite: toNumber(form.scolarite),
        annexes: toNumber(form.annexes),
        autres: toNumber(form.autres),
        currency: classe.currency || "XOF",
      });
      setEnregistrees((prev) => ({ ...prev, [classe.programmeId]: true }));
    } catch (e: any) {
      setErreurs((prev) => ({
        ...prev,
        [classe.programmeId]: e?.message || "Erreur lors de l'enregistrement",
      }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      <h1 className="font-bold whitespace-nowrap text-2xl leading-tight md:text-3xl">Scolarité &mdash; barème par filière</h1>

      <Card>
        <CardContent className="space-y-4 pt-6">
          {/* La filière occupe toute la largeur : les noms sont longs et se
              couperaient dans une colonne partagée. */}
          <div>
            <label className="text-sm text-muted-foreground">Filière</label>
            <SearchableSelect
              className="mt-1 w-full"
              value={filiereId}
              onChange={setFiliereId}
              options={filiereOptions}
              icon={<Layers className="h-4 w-4" />}
              placeholder={
                filieresLoading ? "Chargement des filières..." : "Sélectionner une filière"
              }
              searchPlaceholder="Rechercher une filière..."
              disabled={filieresLoading}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm text-muted-foreground">Cycle</label>
              <SearchableSelect
                className="mt-1 w-full"
                value={cycleFilter}
                onChange={setCycleFilter}
                options={cycleOptions}
                icon={<GraduationCap className="h-4 w-4" />}
                placeholder="Tous les cycles"
                searchPlaceholder="Rechercher un cycle..."
                disabled={!filiereId || classes.length === 0}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Classe</label>
              <SearchableSelect
                className="mt-1 w-full"
                value={classeFilter}
                onChange={setClasseFilter}
                options={classeOptions}
                icon={<BookOpen className="h-4 w-4" />}
                placeholder="Toutes les classes"
                searchPlaceholder="Rechercher une classe..."
                disabled={!filiereId || classesDuCycle.length === 0}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      ) : null}

      {filiereId && isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement du barème...
        </div>
      ) : null}

      {filiereId && !isLoading && classes.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Aucune classe rattachée à cette filière. Créez-en une depuis{" "}
            <Link href="/academic/classes" className="underline">
              Classes
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {filiereId && !isLoading && classes.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {classesAffichees.length} classe{classesAffichees.length > 1 ? "s" : ""} affichée
          {classesAffichees.length > 1 ? "s" : ""}
          {classesAffichees.length !== classes.length ? ` sur ${classes.length}` : ""}
        </p>
      ) : null}

      {filiereId && !isLoading && classes.length > 0 && classesAffichees.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Aucune classe ne correspond aux filtres choisis.</AlertDescription>
        </Alert>
      ) : null}

      {classesAffichees.map((classe) => {
        const form = forms[classe.programmeId];
        if (!form) return null;

        const reference = baseline[classe.programmeId];
        const modifie =
          !reference || CHAMPS.some(({ key }) => toNumber(form[key]) !== toNumber(reference[key]));
        const total = CHAMPS.reduce((somme, { key }) => somme + toNumber(form[key]), 0);
        const enCours = savingId === classe.programmeId;

        return (
          <Card key={classe.programmeId}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-muted-foreground" />
                  {classe.programmeName}
                </CardTitle>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{classe.programmeCode}</Badge>
                  <Badge variant="secondary">{classe.cycleName}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {classe.semestres.length} semestre{classe.semestres.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Total à payer
                </p>
                <p className="text-2xl font-bold">{formatMontant(total, classe.currency)}</p>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {classe.semestres.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Semestre</TableHead>
                      <TableHead className="text-right">UE</TableHead>
                      <TableHead className="text-right">Montant des UE</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classe.semestres.map((semestre) => (
                      <TableRow key={semestre.id}>
                        <TableCell className="font-medium">{semestre.libelle}</TableCell>
                        <TableCell className="text-right">{semestre.nbUe}</TableCell>
                        <TableCell className="text-right">
                          {formatMontant(semestre.montant, classe.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-semibold">
                        Total scolarité ({classe.semestres.length} semestre
                        {classe.semestres.length > 1 ? "s" : ""})
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-right font-semibold">
                        {formatMontant(classe.scolariteCalculee, classe.currency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Aucun semestre pour cette classe : la scolarité ne peut pas être calculée à
                    partir des UE. Saisissez le montant à la main, ou créez les semestres depuis{" "}
                    <Link href="/professionnel/admin/semestres" className="underline">
                      Semestres
                    </Link>
                    .
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {CHAMPS.map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-sm text-muted-foreground">{label}</label>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      className="mt-1"
                      value={form[key]}
                      onChange={(e) => majChamp(classe.programmeId, key, e.target.value)}
                    />
                  </div>
                ))}
              </div>

              {erreurs[classe.programmeId] ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{erreurs[classe.programmeId]}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex items-center gap-3">
                <Button onClick={() => enregistrer(classe)} disabled={enCours || !modifie}>
                  {enCours ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Enregistrement...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Save className="h-4 w-4" /> Enregistrer
                    </span>
                  )}
                </Button>
                {enregistrees[classe.programmeId] && !modifie ? (
                  <span className="flex items-center gap-1 text-sm text-emerald-600">
                    <Check className="h-4 w-4" /> Enregistré
                  </span>
                ) : null}
                {!classe.fees && !enregistrees[classe.programmeId] ? (
                  <span className="text-sm text-muted-foreground">Jamais enregistré</span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
