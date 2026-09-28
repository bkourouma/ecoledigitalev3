"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardContent } from "@ecoledigitale/ui";
import {
  AlertCircle,
  AlertTriangle,
  CalendarRange,
  Edit,
  FileText,
  Loader2,
  Plus,
  Settings,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ExportButtons } from "@/components/ExportButtons";
import { openTeacherConfigsPdf } from "@/lib/utils/teacher-config-report";
import { useToast } from "@/components/ui/use-toast";
import {
  useDeleteTeacherPaymentConfig,
  useTeacherPaymentConfigs,
  type TeacherPaymentConfigRow,
} from "@/lib/hooks/use-teacher-payment-configs";

/**
 * Configuration de la rémunération des enseignants — première étape du parcours
 * de paie : sans configuration, un enseignant n'est pas payable.
 *
 * Le filtre par enseignant travaille sur la liste déjà chargée. Ses options
 * sont tirées du jeu COMPLET, pas du jeu affiché : les dériver du résultat
 * filtré ferait disparaître tous les autres noms dès la première sélection, et
 * il n'y aurait plus moyen d'en changer sans réinitialiser.
 */

const TYPE_LABELS: Record<string, string> = {
  salary: "Salaire fixe",
  hourly: "Taux horaire",
  mixed: "Mixte",
};

/* Mêmes teintes que l'historique des paiements : c'est la même notion de type
   de rémunération, elle doit se reconnaître d'un écran à l'autre. */
const TYPE_STYLES: Record<string, string> = {
  salary: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  hourly: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  mixed: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
};

const fmtMontant = (v: number): string =>
  `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v))} FCFA`;

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "—";
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
};

/** Une configuration court encore si elle n'a pas de fin, ou une fin à venir. */
const estActive = (c: TeacherPaymentConfigRow, aujourdhui: string): boolean =>
  !c.effectiveTo || c.effectiveTo.slice(0, 10) >= aujourdhui;

export default function TeacherPaymentConfigsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [enseignantId, setEnseignantId] = useState("");

  const query = useTeacherPaymentConfigs();
  const supprimer = useDeleteTeacherPaymentConfig();

  const configs = useMemo(() => query.data?.data ?? [], [query.data]);
  const pagination = query.data?.pagination;

  // Options du filtre : un enseignant par entrée, avec son nombre de
  // configurations. Triées par nom pour rester prévisibles.
  const optionsEnseignants = useMemo(() => {
    const parEnseignant = new Map<string, { nom: string; n: number }>();
    for (const c of configs) {
      const courant = parEnseignant.get(c.teacherId);
      if (courant) courant.n += 1;
      else parEnseignant.set(c.teacherId, { nom: c.teacherName ?? "Enseignant", n: 1 });
    }
    return [...parEnseignant.entries()]
      .sort((a, b) => a[1].nom.localeCompare(b[1].nom, "fr"))
      .map(([id, { nom, n }]) => ({ value: id, label: `${nom} (${n})` }));
  }, [configs]);

  const affichees = useMemo(
    () => (enseignantId ? configs.filter((c) => c.teacherId === enseignantId) : configs),
    [configs, enseignantId]
  );

  const stats = useMemo(() => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    return {
      total: affichees.length,
      enseignants: new Set(affichees.map((c) => c.teacherId)).size,
      actives: affichees.filter((c) => estActive(c, aujourdhui)).length,
    };
  }, [affichees]);

  /**
   * Périmètre exporté : exactement les lignes affichées. Le plafond de l'API
   * est reporté dans le document, faute de quoi un enseignant simplement non
   * chargé y passerait pour non configuré.
   */
  const exportOptions = useMemo(
    () => ({
      enseignant: enseignantId
        ? (optionsEnseignants.find((o) => o.value === enseignantId)?.label ?? enseignantId)
        : "Tous les enseignants",
      tronquee: pagination?.hasMore
        ? `${pagination.total} configurations existent : seules les ${configs.length} plus récentes sont reprises ici.`
        : undefined,
    }),
    [enseignantId, optionsEnseignants, pagination, configs.length]
  );

  const lancerSuppression = async (config: TeacherPaymentConfigRow) => {
    const nom = config.teacherName ?? "cet enseignant";
    if (!confirm(`Supprimer la configuration de ${nom} ? Cette action est définitive.`)) return;

    try {
      await supprimer.mutateAsync(config.id);
      toast({ title: "Configuration supprimée", description: `Celle de ${nom} n'existe plus.` });
    } catch (error) {
      toast({
        title: "Suppression impossible",
        description: (error as Error)?.message ?? "Erreur de connexion",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-6">
      <div className="mb-6 flex max-w-full flex-col items-start gap-2 overflow-x-auto md:gap-3">
        <div>
          <h1 className="font-bold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent flex items-center gap-2 whitespace-nowrap text-2xl leading-tight md:text-3xl">
            <Settings className="h-7 w-7 text-indigo-500 shrink-0" />
            Configuration des rémunérations
          </h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Comment chaque enseignant est payé : salaire fixe, taux horaire ou les deux. Un
            enseignant sans configuration n&apos;apparaîtra dans aucun bulletin.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <ExportButtons
            formats={["pdf"]}
            disabled={query.isLoading || affichees.length === 0}
            onExportPdf={(win) => openTeacherConfigsPdf(affichees, exportOptions, win)}
            onError={(message) =>
              toast({ title: "Export impossible", description: message, variant: "destructive" })
            }
          />
          <Button onClick={() => router.push("/payments/teacher-configs/new")}>
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle configuration
          </Button>
        </div>
      </div>

      {/* Filtre */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Enseignant</span>
            <SearchableSelect
              value={enseignantId}
              onChange={setEnseignantId}
              icon={<UserRound className="h-4 w-4 text-muted-foreground" />}
              placeholder="Tous les enseignants"
              searchPlaceholder="Rechercher un enseignant…"
              options={[{ value: "", label: "Tous les enseignants" }, ...optionsEnseignants]}
            />
            <span className="text-xs text-muted-foreground">
              Seuls les enseignants ayant au moins une configuration sont proposés. Le nombre entre
              parenthèses est celui de leurs configurations.
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Indicateurs du périmètre affiché */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Indicateur
          label="Configurations"
          valeur={String(stats.total)}
          icone={<FileText className="h-5 w-5" />}
        />
        <Indicateur
          label="Enseignants concernés"
          valeur={String(stats.enseignants)}
          icone={<Users className="h-5 w-5" />}
        />
        <Indicateur
          label="En vigueur aujourd'hui"
          valeur={String(stats.actives)}
          hint={
            stats.total > stats.actives
              ? `${stats.total - stats.actives} arrivée(s) à échéance`
              : undefined
          }
          icone={<CalendarRange className="h-5 w-5" />}
        />
      </div>

      {/* La liste est plafonnée par l'API : le dire plutôt que tronquer en
          silence, sinon un enseignant absent passe pour non configuré. */}
      {pagination?.hasMore && (
        <Card className="border-amber-500/40">
          <CardContent className="flex items-center gap-3 py-4 text-amber-500 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p>
              {pagination.total} configurations existent, seules les {configs.length} plus récentes
              sont chargées.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Liste */}
      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        </div>
      ) : query.isError ? (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 py-8 text-red-400">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <p>{(query.error as Error)?.message ?? "Impossible de charger les configurations."}</p>
          </CardContent>
        </Card>
      ) : affichees.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <Settings className="h-8 w-8 text-muted-foreground" />
            </div>
            {enseignantId ? (
              <>
                <p className="text-muted-foreground">Aucune configuration pour cet enseignant.</p>
                <Button variant="outline" onClick={() => setEnseignantId("")}>
                  Voir tous les enseignants
                </Button>
              </>
            ) : (
              <>
                <div>
                  <h3 className="text-lg font-semibold">Aucune configuration</h3>
                  <p className="text-muted-foreground mt-1">
                    Tant qu&apos;aucun enseignant n&apos;est configuré, aucun bulletin ne peut être
                    généré.
                  </p>
                </div>
                <Button onClick={() => router.push("/payments/teacher-configs/new")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Créer la première configuration
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {affichees.map((config) => (
            <LigneConfig
              key={config.id}
              config={config}
              onModifier={() => router.push(`/payments/teacher-configs/${config.id}/edit`)}
              onSupprimer={() => lancerSuppression(config)}
              suppressionEnCours={supprimer.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LigneConfig({
  config,
  onModifier,
  onSupprimer,
  suppressionEnCours,
}: {
  config: TeacherPaymentConfigRow;
  onModifier: () => void;
  onSupprimer: () => void;
  suppressionEnCours: boolean;
}) {
  // Un salaire fixe ignore les heures : le calculateur ne lit ni le seuil ni le
  // multiplicateur pour ce type. Afficher leurs valeurs laisserait croire
  // qu'elles pèsent sur le montant.
  const heuresComptent = config.configType !== "salary";

  // Seules les données réellement portées par la configuration sont affichées :
  // une colonne « — » n'apprend rien et fait passer pour incomplet un forfait
  // qui, par nature, n'a ni taux horaire ni seuil.
  const donnees: { label: string; valeur: string; hint?: string; fort?: boolean }[] = [];
  if (config.monthlySalary != null) {
    donnees.push({
      label: "Salaire mensuel",
      valeur: fmtMontant(config.monthlySalary),
      hint: config.annualSalary != null ? `${fmtMontant(config.annualSalary)} / an` : undefined,
      fort: true,
    });
  }
  if (config.defaultHourlyRate != null) {
    donnees.push({
      label: "Taux horaire",
      valeur: `${fmtMontant(config.defaultHourlyRate)}/h`,
      fort: true,
    });
  }
  if (heuresComptent && config.overtimeThreshold != null) {
    donnees.push({ label: "Seuil heures sup.", valeur: `${config.overtimeThreshold} h` });
  }
  if (heuresComptent && config.overtimeMultiplier != null) {
    donnees.push({ label: "Majoration", valeur: `×${config.overtimeMultiplier}` });
  }

  return (
    <Card>
      <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="lg:w-56 shrink-0 min-w-0">
          <div className="font-semibold break-words">{config.teacherName ?? "Enseignant"}</div>
          <div className="text-sm text-muted-foreground break-words">{config.teacherEmail}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {fmtDate(config.effectiveFrom)}
            {config.effectiveTo ? ` → ${fmtDate(config.effectiveTo)}` : " → sans fin"}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 min-w-0">
          {donnees.length === 0 ? (
            <span className="text-sm text-muted-foreground col-span-full">
              Aucun montant paramétré sur cette configuration.
            </span>
          ) : (
            donnees.map((d) => (
              <Donnee key={d.label} label={d.label} valeur={d.valeur} hint={d.hint} fort={d.fort} />
            ))
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
              TYPE_STYLES[config.configType] ?? "bg-muted text-muted-foreground border-border"
            }`}
          >
            {TYPE_LABELS[config.configType] ?? config.configType}
          </span>
          <Button variant="outline" size="sm" onClick={onModifier} title="Modifier">
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSupprimer}
            disabled={suppressionEnCours}
            title="Supprimer"
            className="text-red-400 hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Indicateur({
  label,
  valeur,
  hint,
  icone,
}: {
  label: string;
  valeur: string;
  hint?: string;
  icone: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-indigo-500 shrink-0">{icone}</span>
        </div>
        <div className="text-2xl font-bold mt-1">{valeur}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Donnee({
  label,
  valeur,
  hint,
  fort,
}: {
  label: string;
  valeur: string;
  hint?: string;
  fort?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 break-words ${fort ? "font-semibold" : ""}`}>{valeur}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}
