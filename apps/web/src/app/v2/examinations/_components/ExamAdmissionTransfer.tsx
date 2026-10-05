"use client";

import { useTranslations } from "next-intl";
import { Can } from "@/platform/ui/AccessGate";
import { CheckControl } from "@/platform/ui/FormField";
import { ErrorBlock } from "@/platform/ui/states";
import { useSetTransmitsToAdmission } from "@/platform/v2/examinations-admission";

/**
 * Transmission du résultat (« admis / non admis ») ET de la moyenne aux admissions (Q-E18, CEPE vers l'admission en 6e) : paramètre du
 * type d'examen, désactivé par défaut. La moyenne n'est lisible que du personnel d'admission habilité ; aucun nom ne circule.
 */
export function ExamAdmissionTransfer({ typeId, enabled }: { typeId: string; enabled: boolean }) {
  const t = useTranslations("v2ExaminationsAdmission");
  const save = useSetTransmitsToAdmission(typeId);
  return (
    <section aria-labelledby={`adm-${typeId}`} className="space-y-2">
      <h3 id={`adm-${typeId}`} className="font-semibold">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <Can permission="exam.type.manage" fallback={<p className="text-sm">{enabled ? t("on") : t("off")}</p>}>
        <CheckControl checked={enabled} disabled={save.isPending} onChange={(v) => save.mutate({ transmitsToAdmission: v })} label={t("enabled")} />
      </Can>
      {save.isError ? <ErrorBlock error={save.error} /> : null}
      {save.isSuccess ? <p role="status" className="text-xs text-muted-foreground">{t("saved")}</p> : null}
    </section>
  );
}
