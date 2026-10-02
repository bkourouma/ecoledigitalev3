"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ASSET_TYPES, MAX_ASSET_BYTES, putAsset, useAssetUpload, type AssetType } from "@/platform/v2/reportcards";
import { FormField } from "@/platform/ui/FormField";
import { buttonClass } from "@/platform/ui/PageHeader";
import { useDescribeError } from "@/platform/ui/errors";

/**
 * Image d'identité (logo, emblème, signature) : le fichier est contrôlé ici (type, 2 Mo) puis téléversé par URL signée ;
 * seule la CLÉ de l'objet est enregistrée avec l'identité. Le serveur recontrôle le contenu par ses octets.
 */
export function ImageUploadField({ kind, label, value, onChange }: { kind: "logo" | "emblem" | "signature"; label: string; value: string; onChange: (objectKey: string) => void }) {
  const t = useTranslations("v2Reportcards.upload");
  const describe = useDescribeError();
  const request = useAssetUpload();
  const [state, setState] = useState<"idle" | "uploading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!(ASSET_TYPES as readonly string[]).includes(file.type)) return setError(t("badType"));
    if (file.size > MAX_ASSET_BYTES) return setError(t("tooLarge"));
    setError(null);
    setState("uploading");
    try {
      const upload = await request.mutateAsync({ kind, contentType: file.type as AssetType });
      await putAsset(upload, file);
      onChange(upload.objectKey);
      setState("done");
    } catch (e) {
      setState("idle");
      setError(describe(e));
    }
  }

  return (
    <FormField label={label} error={error} hint={value ? t("current", { key: value.split("/").pop() ?? value }) : t("hint")}>
      {(c) => (
        <div className="flex flex-wrap items-center gap-2">
          <input {...c} type="file" accept={ASSET_TYPES.join(",")} onChange={(e) => void pick(e.target.files?.[0])} disabled={state === "uploading"} className="block max-w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium" />
          {value ? (
            <button type="button" className={buttonClass.ghost} onClick={() => onChange("")}>
              {t("remove")}
            </button>
          ) : null}
          <span role="status" className="text-xs text-muted-foreground">
            {state === "uploading" ? t("uploading") : state === "done" ? t("uploaded") : ""}
          </span>
        </div>
      )}
    </FormField>
  );
}
