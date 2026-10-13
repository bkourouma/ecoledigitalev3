"use client";

import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { DraftConflict, GradeValue } from "@/platform/offline/grade-drafts";
import { buttonClass } from "@/platform/ui/PageHeader";
import { Notice } from "@/platform/ui/states";

/**
 * Résolution des conflits de notes saisies hors ligne. Pour chaque élève dont la note a changé sur le serveur pendant la saisie :
 * « Garder la mienne » (renvoyée explicitement sur la version courante), « Prendre celle du serveur » (ma saisie est abandonnée) et
 * « Voir les deux » (comparaison détaillée : valeur, commentaire, instant de saisie, version du serveur). RIEN n'est choisi
 * automatiquement et rien n'est envoyé tant que la personne n'a pas décidé.
 */
export function GradeConflictResolver({
  conflicts,
  studentLabel,
  scaleMax,
  onResolve,
}: {
  conflicts: ReadonlyArray<DraftConflict>;
  studentLabel: (enrollmentId: string) => string;
  scaleMax: string;
  onResolve: (enrollmentId: string, choice: "mine" | "server") => Promise<boolean>;
}) {
  const t = useTranslations("v2Offline.grades.conflicts");
  const tEntry = useTranslations("v2Assess.entryStatus");
  const format = useFormatter();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [announce, setAnnounce] = useState("");
  const [failed, setFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  if (conflicts.length === 0) {
    // Annonce de la dernière résolution (la zone reste dans le DOM pour être lue).
    return announce ? (
      <p role="status" className="sr-only">
        {announce}
      </p>
    ) : null;
  }

  const show = (v: GradeValue): string => (v.entryStatus === "ENTERED" ? (v.score ?? "").replace(".", ",") || t("empty") : tEntry(v.entryStatus));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function choose(c: DraftConflict, choice: "mine" | "server") {
    setFailed(false);
    const ok = await onResolve(c.enrollmentId, choice);
    if (!ok) {
      setFailed(true);
      return;
    }
    setAnnounce(t(choice === "mine" ? "resolvedMine" : "resolvedServer", { name: studentLabel(c.enrollmentId) }));
    // Le conflit résolu disparaît de la liste : le focus revient au titre pour ne pas se perdre.
    headingRef.current?.focus();
  }

  return (
    <section aria-labelledby="grade-conflicts-title" className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4" data-testid="grade-conflicts">
      <h2 id="grade-conflicts-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("title")}
      </h2>
      <p className="text-sm">{t("intro", { count: conflicts.length })}</p>
      <p className="text-xs text-muted-foreground">{t("warning")}</p>
      {failed ? <Notice kind="warning">{t("needServer")}</Notice> : null}
      <p role="status" className="sr-only">
        {announce}
      </p>
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">
                {t("student")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("mine")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("server")}
              </th>
              <th scope="col" className="px-3 py-2">
                {t("actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => {
              const name = studentLabel(c.enrollmentId);
              const expanded = open.has(c.enrollmentId);
              const detailId = `conflict-detail-${c.enrollmentId}`;
              return (
                <tr key={c.enrollmentId} className="border-t align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {name}
                  </th>
                  <td className="px-3 py-2">
                    <span className="tabular-nums">{show(c.mine)}</span>
                    {expanded ? (
                      <span id={detailId} className="mt-1 block text-xs text-muted-foreground">
                        {t("mineAt", { time: format.dateTime(new Date(c.mine.editedAt), { dateStyle: "short", timeStyle: "short" }) })}
                        {c.mine.comment ? <span className="block">{t("comment", { value: c.mine.comment })}</span> : null}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {c.server ? (
                      <>
                        <span className="tabular-nums">{show(c.server)}</span>
                        {expanded ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {t("serverVersion", { version: c.server.rowVersion })}
                            {c.server.comment ? <span className="block">{t("comment", { value: c.server.comment })}</span> : null}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("serverUnknown")}</span>
                    )}
                    {/* barème : rappel pour comparer deux valeurs saisies sur la même échelle */}
                    <span className="sr-only"> / {scaleMax.replace(".", ",")}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={buttonClass.secondary} disabled={!c.server} onClick={() => void choose(c, "mine")} aria-label={t("keepMineOf", { name })}>
                        {t("keepMine")}
                      </button>
                      <button type="button" className={buttonClass.secondary} onClick={() => void choose(c, "server")} aria-label={t("takeServerOf", { name })}>
                        {t("takeServer")}
                      </button>
                      <button type="button" className={buttonClass.ghost} aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={() => toggle(c.enrollmentId)} aria-label={t(expanded ? "hideBothOf" : "showBothOf", { name })}>
                        {t(expanded ? "hideBoth" : "showBoth")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
