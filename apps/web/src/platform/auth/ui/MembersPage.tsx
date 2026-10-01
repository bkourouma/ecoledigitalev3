"use client";

import { useCallback, useEffect, useState } from "react";
import { LEGACY_ROLE_COMPOSITION } from "@ecoledigitale/contracts/v2/iam-legacy-roles";
import { Button } from "@/components/ui/button";
import { AuthShell, FormAlert } from "./AuthShell";
import { TextField } from "./fields";
import { explainIamError, iamApi } from "./iam-api";
import { useIamSession } from "./useIamSession";

type Member = Awaited<ReturnType<typeof iamApi.listMembers>>["members"][number];

/** Rôles proposables à l'invitation (clés d'accès IAM = vocabulaire des comptes importés ; l'API les valide). */
const INVITABLE_ROLES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "teacher", label: "Enseignant" },
  { key: "student", label: "Élève / étudiant" },
  { key: "parent", label: "Parent" },
  { key: "admin", label: "Administrateur" },
];

const STATUS_LABEL: Record<Member["status"], string> = { invited: "Invité", active: "Actif", suspended: "Suspendu", revoked: "Révoqué" };

/**
 * Administration des membres de l'établissement (permissions `iam.user.read|invite|manage`, `iam.session.revoke`,
 * `iam.mfa.reset` vérifiées par l'API : un refus est affiché, jamais contourné côté interface).
 */
export function MembersPage() {
  const { status } = useIamSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("teacher");

  const load = useCallback(async () => {
    try {
      setMembers((await iamApi.listMembers()).members);
      setError("");
    } catch (e) {
      setError(explainIamError(e));
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") void load();
  }, [status, load]);

  const act = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      await load();
    } catch (e) {
      setError(explainIamError(e));
    } finally {
      setBusy(null);
    }
  };

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    void act("invite", async () => {
      const wanted = email.trim().toLowerCase();
      await iamApi.inviteMember({ email: wanted, roles: [role] });
      setEmail("");
      // Un accès IAM ne donne aucun droit RBAC par lui-même : on attribue les rôles système équivalents (inverse de
      // `legacyRoleToTemplate`) à la personne invitée. Refus de l'API (permission manquante) : signalé, jamais ignoré.
      try {
        const templates = LEGACY_ROLE_COMPOSITION[role] ?? [];
        const [{ members: all }, { roles }] = await Promise.all([iamApi.listMembers(), iamApi.listRbacRoles()]);
        const identityId = all.find((m) => m.email === wanted)?.identityId;
        if (!identityId) throw new Error("introuvable");
        for (const templateKey of templates) {
          const target = roles.find((r) => r.templateKey === templateKey);
          if (target) await iamApi.assignRbacRole(identityId, target.id);
        }
      } catch {
        return "Invitation envoyée, mais les droits n'ont pas pu être attribués automatiquement : attribuez le rôle depuis la gestion des rôles.";
      }
      return "Invitation envoyée. La personne définit son mot de passe depuis le lien reçu par e-mail.";
    });
  };

  return (
    <AuthShell title="Membres de l'établissement" description="Invitez des personnes, suspendez un accès, révoquez des sessions." wide>
      {error ? <FormAlert>{error}</FormAlert> : null}
      {notice ? <FormAlert kind="success">{notice}</FormAlert> : null}

      <form onSubmit={invite} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end" noValidate>
        <TextField label="Adresse e-mail à inviter" type="email" autoComplete="off" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium">
            Rôle
          </label>
          <select id="invite-role" className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
            {INVITABLE_ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" className="h-11" disabled={busy !== null || !email}>
          {busy === "invite" ? "Envoi…" : "Inviter"}
        </Button>
      </form>

      {members === null && !error ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
      <ul className="space-y-3" aria-label="Membres">
        {(members ?? []).map((m) => (
          <li key={m.membershipId} className="space-y-2 rounded-lg border p-3 text-sm" data-testid="member-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-all font-medium">{m.email}</p>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{STATUS_LABEL[m.status]}</span>
            </div>
            <p className="text-muted-foreground">
              {m.roles.join(", ")}
              {m.mfaEnabled ? " · 2 étapes" : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {m.status === "active" ? (
                <Button type="button" variant="outline" className="h-11" disabled={busy !== null} onClick={() => void act(`s-${m.membershipId}`, async () => { await iamApi.updateMember(m.membershipId, { status: "suspended" }); return `Accès de ${m.email} suspendu.`; })}>
                  Suspendre
                </Button>
              ) : null}
              {m.status === "suspended" ? (
                <Button type="button" variant="outline" className="h-11" disabled={busy !== null} onClick={() => void act(`r-${m.membershipId}`, async () => { await iamApi.updateMember(m.membershipId, { status: "active" }); return `Accès de ${m.email} rétabli.`; })}>
                  Rétablir
                </Button>
              ) : null}
              <Button type="button" variant="outline" className="h-11" disabled={busy !== null} onClick={() => void act(`x-${m.membershipId}`, async () => { const r = await iamApi.revokeMemberSessions(m.membershipId); return `${r.revoked} session(s) révoquée(s).`; })}>
                Révoquer les sessions
              </Button>
              {m.mfaEnabled ? (
                <Button type="button" variant="outline" className="h-11" disabled={busy !== null} onClick={() => void act(`m-${m.membershipId}`, async () => { await iamApi.resetMemberMfa(m.membershipId); return `Vérification en deux étapes de ${m.email} réinitialisée.`; })}>
                  Réinitialiser la MFA
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </AuthShell>
  );
}
