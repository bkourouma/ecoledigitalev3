"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, Button, Input } from "@ecoledigitale/ui";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  GraduationCap,
  Loader2,
  Mail,
  Search,
  Send,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  useRegistrationRequests,
  useApproveRegistration,
  useRejectRegistration,
  useCredentialAccounts,
  useSendCredentials,
  type AccountType,
  type RegistrationRequest,
  type RegistrationStatus,
  type CredentialAccount,
  type ApproveResult,
  type SendCredentialsResult,
} from "@/lib/hooks/use-registration-requests";
import { useActiveAcademicYear } from "@/lib/hooks/use-academic-years";

type Tab = "requests" | "credentials";

const STATUS_META: Record<RegistrationStatus, { label: string; className: string }> = {
  pending: { label: "En attente", className: "bg-amber-500/15 text-amber-300" },
  approved: { label: "Validée", className: "bg-emerald-500/15 text-emerald-300" },
  rejected: { label: "Rejetée", className: "bg-red-500/15 text-red-300" },
};

const SELECT_CLASS =
  "h-11 rounded-md border border-border bg-background text-foreground px-3 text-sm";
const TEXTAREA_CLASS =
  "mt-1 w-full rounded-md border border-border bg-background text-foreground px-3 py-2 text-sm";

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

interface FamilyChild {
  firstName?: string;
  lastName?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  placeOfBirth?: string;
  nationality?: string;
}

/** Children embedded in a family (parent-led) registration request. */
function getChildren(request: RegistrationRequest): FamilyChild[] {
  const list = request.details?.children;
  return Array.isArray(list) ? (list as FamilyChild[]) : [];
}

export default function RegistrationsPage() {
  const [tab, setTab] = useState<Tab>("requests");

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div>
        <h1 className="font-bold bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
          Inscriptions en ligne
        </h1>
        <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
          Validez les demandes d&apos;inscription et envoyez les identifiants aux étudiants et
          parents.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border">
        <TabButton active={tab === "requests"} onClick={() => setTab("requests")} icon={Clock}>
          Demandes d&apos;inscription
        </TabButton>
        <TabButton
          active={tab === "credentials"}
          onClick={() => setTab("credentials")}
          icon={Mail}
        >
          Envoi des identifiants
        </TabButton>
      </div>

      {tab === "requests" ? <RequestsTab /> : <CredentialsTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-blue-500 text-blue-400"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Requests tab                                                        */
/* ------------------------------------------------------------------ */

function RequestsTab() {
  const [status, setStatus] = useState<RegistrationStatus | "all">("pending");
  const [accountType, setAccountType] = useState<AccountType | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [detail, setDetail] = useState<RegistrationRequest | null>(null);
  const [approveTarget, setApproveTarget] = useState<RegistrationRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RegistrationRequest | null>(null);

  const { data, isLoading, error } = useRegistrationRequests({
    status,
    accountType,
    search: search || undefined,
    page,
    limit: 20,
  });

  const requests = data?.requests || [];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="shadow-sm">
        <CardContent className="p-5">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Rechercher par nom ou email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-10 h-11"
              />
            </div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as RegistrationStatus | "all");
                setPage(1);
              }}
              className={SELECT_CLASS}
            >
              <option value="pending">En attente</option>
              <option value="approved">Validées</option>
              <option value="rejected">Rejetées</option>
              <option value="all">Toutes</option>
            </select>
            <select
              value={accountType}
              onChange={(e) => {
                setAccountType(e.target.value as AccountType | "all");
                setPage(1);
              }}
              className={SELECT_CLASS}
            >
              <option value="all">Tous les types</option>
              <option value="student">Étudiants</option>
              <option value="parent">Parents</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Chargement des demandes...
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="text-muted-foreground">
              Impossible de charger les demandes d&apos;inscription.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && requests.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="bg-muted rounded-full w-16 h-16 flex items-center justify-center">
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-lg">Aucune demande pour ce filtre.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((req) => (
            <RequestRow
              key={req.id}
              request={req}
              onView={() => setDetail(req)}
              onApprove={() => setApproveTarget(req)}
              onReject={() => setRejectTarget(req)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} sur {data.totalPages} ({data.total} demande
            {data.total !== 1 ? "s" : ""})
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
            >
              Suivant
            </Button>
          </div>
        </div>
      )}

      {detail && <DetailModal request={detail} onClose={() => setDetail(null)} />}
      {approveTarget && (
        <ApproveModal request={approveTarget} onClose={() => setApproveTarget(null)} />
      )}
      {rejectTarget && (
        <RejectModal request={rejectTarget} onClose={() => setRejectTarget(null)} />
      )}
    </div>
  );
}

function RequestRow({
  request,
  onView,
  onApprove,
  onReject,
}: {
  request: RegistrationRequest;
  onView: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const meta = STATUS_META[request.status];
  const children = getChildren(request);
  const isFamily = children.length > 0;
  const Icon = request.accountType === "parent" ? Users : GraduationCap;

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div
            className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${
              request.accountType === "parent"
                ? "bg-rose-500/15 text-rose-400"
                : "bg-blue-500/15 text-blue-400"
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-foreground">
                {request.firstName} {request.lastName}
              </p>
              <span className={`text-xs px-2 py-0.5 rounded-full ${meta.className}`}>
                {meta.label}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {isFamily
                  ? `Famille · ${children.length} enfant${children.length > 1 ? "s" : ""}`
                  : request.accountType === "parent"
                    ? "Parent"
                    : "Étudiant"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {request.email}
              {request.phone ? ` · ${request.phone}` : ""}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Demande du {formatDate(request.createdAt)}
            </p>
          </div>

          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={onView} title="Détails">
              <Eye className="h-4 w-4" />
            </Button>
            {request.status === "pending" && (
              <>
                <Button
                  size="sm"
                  onClick={onApprove}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Valider
                </Button>
                <Button
                  size="sm"
                  onClick={onReject}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  <X className="h-4 w-4 mr-1" />
                  Rejeter
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

function Modal({
  title,
  onClose,
  children,
  width = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-card text-card-foreground rounded-xl shadow-2xl w-full ${width} max-h-[90vh] overflow-y-auto border border-border`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

function DetailModal({
  request,
  onClose,
}: {
  request: RegistrationRequest;
  onClose: () => void;
}) {
  const d = request.details || {};
  const children = getChildren(request);
  return (
    <Modal title="Détails de la demande" onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Prénom" value={request.firstName} />
        <Field label="Nom" value={request.lastName} />
        <Field label="Email" value={request.email} />
        <Field label="Téléphone" value={request.phone} />
        <Field label="Date de naissance" value={formatDate(request.dateOfBirth)} />
        <Field label="Genre" value={request.gender} />
        <Field label="Adresse" value={request.address} />
        <Field
          label="Type de compte"
          value={request.accountType === "parent" ? "Parent" : "Étudiant"}
        />
        {request.accountType === "student" ? (
          <>
            <Field label="Lieu de naissance" value={d.placeOfBirth} />
            <Field label="Nationalité" value={d.nationality} />
            <Field label="Niveau souhaité" value={d.currentYear} />
            <Field label="Nom du père" value={d.fatherName} />
            <Field label="Nom de la mère" value={d.motherName} />
          </>
        ) : (
          <>
            <Field label="Lien de parenté" value={d.relationship} />
            <Field label="Matricule de l'enfant" value={d.childMatricule} />
            <Field label="Profession" value={d.profession} />
          </>
        )}
      </div>

      {children.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Enfant(s) à inscrire ({children.length})
          </p>
          <div className="space-y-2">
            {children.map((child, index) => (
              <div
                key={index}
                className="rounded-lg border border-border bg-muted/40 p-3"
              >
                <p className="text-sm font-medium text-foreground">
                  {child.firstName} {child.lastName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    child.email,
                    child.gender,
                    child.nationality,
                    child.dateOfBirth ? formatDate(child.dateOfBirth) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Aucune information complémentaire"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {request.status === "rejected" && request.rejectionReason && (
        <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
          <p className="text-xs font-medium text-red-300">Motif du rejet</p>
          <p className="text-sm text-foreground">{request.rejectionReason}</p>
        </div>
      )}
      <div className="mt-6 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </Modal>
  );
}

function CopyableValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted border border-border px-3 py-2">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-mono text-foreground">{value}</p>
      </div>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-muted-foreground hover:text-foreground"
        title="Copier"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function ApproveModal({
  request,
  onClose,
}: {
  request: RegistrationRequest;
  onClose: () => void;
}) {
  const isStudent = request.accountType === "student";
  const children = getChildren(request);
  const isFamily = children.length > 0;
  const involvesStudents = isStudent || isFamily;
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ApproveResult | null>(null);
  const approve = useApproveRegistration();
  const { data: activeYear, isLoading: yearLoading } = useActiveAcademicYear();
  const activeYearName: string | undefined = (activeYear as any)?.data?.name;

  const handleApprove = async () => {
    try {
      const res = await approve.mutateAsync({
        id: request.id,
        notes: notes.trim() || undefined,
      });
      setResult(res);
    } catch {
      /* error surfaced via approve.error */
    }
  };

  if (result) {
    const resultChildren = result.children ?? [];
    return (
      <Modal title="Inscription validée" onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            <p className="font-medium">
              {resultChildren.length > 0
                ? `Le compte parent et ${resultChildren.length} compte(s) enfant(s) ont été créés.`
                : "Le compte a été créé avec succès."}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {result.emailSent
              ? "Les identifiants ont été envoyés par email au demandeur."
              : "L'email n'a pas pu être envoyé. Communiquez les identifiants ci-dessous manuellement."}
          </p>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {isFamily ? "Compte parent" : "Compte"}
            </p>
            {result.matricule && (
              <CopyableValue label="Matricule" value={result.matricule} />
            )}
            <CopyableValue label="Email de connexion" value={result.email} />
            <CopyableValue label="Mot de passe" value={result.password} />
          </div>

          {resultChildren.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                Comptes enfants ({resultChildren.length})
              </p>
              {resultChildren.map((child, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border bg-muted/40 p-3 space-y-2"
                >
                  <p className="text-sm font-medium text-foreground">
                    {child.name} · {child.matricule}
                  </p>
                  <CopyableValue label="Email de connexion" value={child.email} />
                  <CopyableValue label="Mot de passe" value={child.password} />
                </div>
              ))}
            </div>
          )}

          {!result.emailSent && result.emailError && (
            <p className="text-xs text-amber-300">Email : {result.emailError}</p>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Terminer</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Valider l'inscription" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {isFamily ? (
            <>
              Vous êtes sur le point de créer le compte parent de{" "}
              <strong className="text-foreground">
                {request.firstName} {request.lastName}
              </strong>{" "}
              ({request.email}) ainsi que{" "}
              <strong className="text-foreground">
                {children.length} compte{children.length > 1 ? "s" : ""} enfant
                {children.length > 1 ? "s" : ""}
              </strong>
              , tous liés entre eux. Les mots de passe seront générés et envoyés par email
              au parent.
            </>
          ) : (
            <>
              Vous êtes sur le point de créer un compte {isStudent ? "étudiant" : "parent"}{" "}
              pour{" "}
              <strong className="text-foreground">
                {request.firstName} {request.lastName}
              </strong>{" "}
              ({request.email}). Un mot de passe sera généré et envoyé par email.
            </>
          )}
        </p>

        {isFamily && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Enfant(s) à créer
            </p>
            <ul className="text-sm text-foreground list-disc list-inside">
              {children.map((child, index) => (
                <li key={index}>
                  {child.firstName} {child.lastName}
                </li>
              ))}
            </ul>
          </div>
        )}

        {involvesStudents && (
          <div>
            <label className="text-sm font-medium text-foreground">Année académique</label>
            <div className="mt-1 flex h-11 items-center rounded-md border border-border bg-muted px-3 text-sm">
              {yearLoading ? (
                <span className="text-muted-foreground">Chargement…</span>
              ) : activeYearName ? (
                <span className="font-medium text-foreground">{activeYearName}</span>
              ) : (
                <span className="text-amber-300">Aucune année académique active</span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isFamily ? "Les enfants seront rattachés" : "L'étudiant sera rattaché"} à
              l&apos;année académique active.
            </p>
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-foreground">
            Note interne (optionnel)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={TEXTAREA_CLASS}
          />
        </div>

        {approve.isError && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
            {(approve.error as Error)?.message || "Échec de la validation."}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={approve.isPending}>
            Annuler
          </Button>
          <Button
            onClick={handleApprove}
            disabled={approve.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {approve.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Validation...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-1" />
                Valider et créer {isFamily ? "les comptes" : "le compte"}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RejectModal({
  request,
  onClose,
}: {
  request: RegistrationRequest;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const reject = useRejectRegistration();

  const handleReject = async () => {
    try {
      await reject.mutateAsync({ id: request.id, rejectionReason: reason.trim() || undefined });
      onClose();
    } catch {
      /* error surfaced via reject.error */
    }
  };

  return (
    <Modal title="Rejeter la demande" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Rejeter la demande de{" "}
          <strong className="text-foreground">
            {request.firstName} {request.lastName}
          </strong>
          . Le demandeur sera informé par email.
        </p>
        <div>
          <label className="text-sm font-medium text-foreground">Motif (optionnel)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Expliquez la raison du rejet..."
            className={TEXTAREA_CLASS}
          />
        </div>

        {reject.isError && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
            {(reject.error as Error)?.message || "Échec du rejet."}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={reject.isPending}>
            Annuler
          </Button>
          <Button
            onClick={handleReject}
            disabled={reject.isPending}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {reject.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Rejet...
              </>
            ) : (
              "Confirmer le rejet"
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Credentials tab                                                     */
/* ------------------------------------------------------------------ */

function CredentialsTab() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountType | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendResult, setSendResult] = useState<SendCredentialsResult | null>(null);

  const { data, isLoading, error } = useCredentialAccounts(search || undefined);
  const sendCredentials = useSendCredentials();

  const accounts: CredentialAccount[] = useMemo(() => {
    if (!data) return [];
    const list = [...(data.students || []), ...(data.parents || [])];
    return typeFilter === "all" ? list : list.filter((a) => a.accountType === typeFilter);
  }, [data, typeFilter]);

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === accounts.length ? new Set() : new Set(accounts.map((a) => a.userId))
    );
  };

  const send = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    try {
      const res = await sendCredentials.mutateAsync(userIds);
      setSendResult(res);
      setSelected(new Set());
    } catch {
      /* error surfaced via sendCredentials.error */
    }
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardContent className="p-5">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Rechercher par nom ou email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-11"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as AccountType | "all")}
              className={SELECT_CLASS}
            >
              <option value="all">Tous les comptes</option>
              <option value="student">Étudiants</option>
              <option value="parent">Parents</option>
            </select>
            <Button
              onClick={() => send(Array.from(selected))}
              disabled={selected.size === 0 || sendCredentials.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white h-11"
            >
              {sendCredentials.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Envoyer la sélection ({selected.size})
            </Button>
          </div>
        </CardContent>
      </Card>

      {sendCredentials.isError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
          {(sendCredentials.error as Error)?.message || "Échec de l'envoi."}
        </div>
      )}

      {sendResult && (
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
          <div className="flex items-center gap-2 text-blue-300">
            <CheckCircle2 className="h-5 w-5" />
            <p className="font-medium">
              {sendResult.sent} email{sendResult.sent !== 1 ? "s" : ""} envoyé
              {sendResult.sent !== 1 ? "s" : ""}
              {sendResult.failed > 0 ? `, ${sendResult.failed} échec(s)` : ""}.
            </p>
            <button
              onClick={() => setSendResult(null)}
              className="ml-auto text-blue-300/70 hover:text-blue-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {sendResult.results.some((r) => r.passwordReset) && (
            <p className="text-xs text-blue-300/80 mt-1">
              Un nouveau mot de passe a été généré pour les comptes qui n&apos;en avaient pas.
            </p>
          )}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Chargement des comptes...
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="text-muted-foreground">Impossible de charger les comptes.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && accounts.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="bg-muted rounded-full w-16 h-16 flex items-center justify-center">
              <UserPlus className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-lg">Aucun compte trouvé.</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && accounts.length > 0 && (
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3 bg-muted">
              <input
                type="checkbox"
                checked={selected.size === accounts.length && accounts.length > 0}
                onChange={toggleAll}
                className="h-4 w-4 accent-blue-600"
              />
              <span className="text-sm font-medium text-muted-foreground">
                {accounts.length} compte{accounts.length !== 1 ? "s" : ""}
                {selected.size > 0 ? ` · ${selected.size} sélectionné(s)` : ""}
              </span>
            </div>
            <div className="divide-y divide-border">
              {accounts.map((acc) => {
                const sent = sendResult?.results.find((r) => r.userId === acc.userId);
                return (
                  <div
                    key={acc.userId}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(acc.userId)}
                      onChange={() => toggle(acc.userId)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        acc.accountType === "parent"
                          ? "bg-rose-500/15 text-rose-400"
                          : "bg-blue-500/15 text-blue-400"
                      }`}
                    >
                      {acc.accountType === "parent" ? (
                        <Users className="h-4 w-4" />
                      ) : (
                        <GraduationCap className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {acc.name}
                        {acc.matricule ? (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            · {acc.matricule}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{acc.email}</p>
                    </div>

                    {sent && (
                      <span
                        className={`text-xs flex items-center gap-1 ${
                          sent.status === "sent" ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {sent.status === "sent" ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Envoyé
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3.5 w-3.5" />
                            {sent.status === "no_email" ? "Pas d'email" : "Échec"}
                          </>
                        )}
                      </span>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => send([acc.userId])}
                      disabled={sendCredentials.isPending}
                    >
                      <Mail className="h-4 w-4 mr-1" />
                      Envoyer
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
