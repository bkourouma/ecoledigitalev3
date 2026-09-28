"use client";

import { useEffect, useRef } from "react";

/**
 * Amène un message de confirmation ou d'erreur sous les yeux de l'utilisateur.
 *
 * Plusieurs écrans d'administration rendent leur retour (succès, erreur) en
 * haut de page, alors que le bouton qui le déclenche est tout en bas — après
 * une longue liste de cases à cocher. Le message s'affichait donc hors écran :
 * rien ne semblait se passer, et rien n'empêchait de cliquer une seconde fois.
 *
 * Usage : attacher le `ref` renvoyé au conteneur du message, et passer comme
 * `trigger` la valeur qui apparaît quand il y a quelque chose à montrer.
 */
export function useScrollIntoViewOn(trigger: unknown) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!trigger) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [trigger]);

  return ref;
}
