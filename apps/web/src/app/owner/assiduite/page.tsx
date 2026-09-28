"use client";

import { OwnerTabs } from "@/components/owner/OwnerTabs";
import { Presences } from "./Presences";
import { Conduite } from "./Conduite";

/**
 * Présences & conduite — le menu l'annonçait depuis le miroir, l'écran ne
 * portait que la moitié.
 *
 * Les deux onglets lisent le MÊME endpoint et le même périmètre : la conduite
 * arrive avec les présences, sans second appel. Ils sont séparés parce que les
 * questions le sont — « qui vient en cours » et « qui est noté sur sa tenue » —
 * mais un fondateur les lit l'un après l'autre : une classe très absente avec
 * 16 de moyenne de conduite pose une question que ni l'un ni l'autre chiffre ne
 * pose seul.
 */
export default function OwnerAssiduitePage() {
  return (
    <OwnerTabs
      tabs={[
        { value: "presences", label: "Présences", content: <Presences /> },
        { value: "conduite", label: "Conduite", content: <Conduite /> },
      ]}
    />
  );
}
