"use client";

import { useEffect } from "react";
import { syncServiceWorker } from "./register";

/** Enregistre `/sw.js` après le chargement de la page (n'alourdit pas le premier rendu). */
export function RegisterServiceWorker(): null {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const run = () => {
      syncServiceWorker(navigator, {
        flag: process.env.NEXT_PUBLIC_PWA,
        nodeEnv: process.env.NODE_ENV,
      }).catch((error) => {
        if (process.env.NODE_ENV !== "production") console.warn("[pwa] service worker :", error);
      });
    };
    if (document.readyState === "complete") run();
    else {
      window.addEventListener("load", run, { once: true });
      return () => window.removeEventListener("load", run);
    }
  }, []);
  return null;
}
