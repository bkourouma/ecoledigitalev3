"use client";

import { useEffect, useState } from "react";

/** Valeur temporisée : suit `value` après `delayMs` sans changement (une requête de recherche par pause de frappe). */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
