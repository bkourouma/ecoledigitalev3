"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Bascule entre les deux moitiés d'un écran fusionné.
 *
 * POURQUOI L'ONGLET VIT DANS L'URL
 * Trois raisons, aucune cosmétique :
 *  - la barre de filtres est montée par le layout, au-dessus de la page ; elle
 *    lit `?vue=` pour n'afficher que les dimensions que l'onglet regardé
 *    applique réellement (cf. `OWNER_FILTER_SCOPE`) ;
 *  - les écrans absorbés gardent une adresse propre : `/owner/academique`
 *    redirige vers `/owner/pedagogie?vue=scolaire`, et tous les liens profonds
 *    existants — alertes de pilotage, tuiles du pouls, favoris — continuent
 *    d'arriver au bon endroit ;
 *  - un lien envoyé à son directeur des études ouvre le même onglet.
 *
 * POURQUOI PAS DE `forceMount`
 * L'onglet inactif est démonté : ses requêtes ne partent pas. Monter les deux
 * moitiés d'un écran de finances doublerait les appels réseau pour une moitié
 * que personne ne regarde.
 */

export interface OwnerTab {
  /** Valeur écrite dans `?vue=`. Reste stable : elle vit dans des liens. */
  value: string;
  label: string;
  content: React.ReactNode;
}

export function OwnerTabs({
  tabs,
  defaultValue,
}: {
  tabs: OwnerTab[];
  /** Onglet affiché quand l'URL n'en désigne aucun. Le premier par défaut. */
  defaultValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const demande = searchParams.get("vue");
  // Une valeur inconnue dans l'URL (onglet renommé, lien ancien) retombe sur le
  // premier onglet plutôt que d'afficher une page vide.
  const actif =
    tabs.find((t) => t.value === demande)?.value ?? defaultValue ?? tabs[0]?.value;

  const changer = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("vue", value);
    // `replace` et non `push` : l'aller-retour entre deux onglets ne doit pas
    // remplir l'historique au point que « Précédent » ne sorte plus de l'écran.
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={actif} onValueChange={changer} className="space-y-6">
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="space-y-8">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
