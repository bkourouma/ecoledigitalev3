/**
 * Enregistre du texte comme fichier téléchargé (export CSV, calendrier iCalendar). `bom` : préfixe UTF-8 pour que les
 * tableurs (Excel) lisent correctement les accents d'un CSV.
 */
export function downloadTextFile(fileName: string, content: string, mime: string, options: { bom?: boolean } = {}): void {
  const blob = new Blob([options.bom ? `﻿${content}` : content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Laisse le navigateur démarrer le téléchargement avant de libérer l'URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
