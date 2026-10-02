"use client";

import { useEffect, useState } from "react";

/** QR d'un lien (SVG produit localement : aucune donnée ne quitte la page). Rien n'est affiché tant que le SVG n'est pas prêt. */
export function QrCode({ value, label, size = 160 }: { value: string; label: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then((m) => m.toString(value, { type: "svg", margin: 1, width: size }))
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!svg) return null;
  return <div role="img" aria-label={label} style={{ width: size, height: size }} className="shrink-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
