/** Chargement d'images (logo, emblème) en data URL pour jsPDF — partagé entre les générateurs PDF. */
import { LOGO_INSTITUT, LOGO_EMBLEME } from "./bulletin-format";

export interface PdfImg {
  dataUrl: string;
  ratio: number;
}

export async function loadPdfImg(url: string): Promise<PdfImg | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((r) => {
      const f = new FileReader();
      f.onloadend = () => r(f.result as string);
      f.readAsDataURL(blob);
    });
    const ratio: number = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i.width / i.height || 1);
      i.onerror = () => r(1);
      i.src = dataUrl;
    });
    return { dataUrl, ratio };
  } catch {
    return null;
  }
}

export interface PdfHeaderImages {
  logoInstitut: PdfImg | null;
  embleme: PdfImg | null;
}

export async function loadPdfHeaderImages(): Promise<PdfHeaderImages> {
  const [logoInstitut, embleme] = await Promise.all([
    loadPdfImg(LOGO_INSTITUT),
    loadPdfImg(LOGO_EMBLEME),
  ]);
  return { logoInstitut, embleme };
}

export interface DiplomeHeaderImages extends PdfHeaderImages {
  ministere: PdfImg | null;
}

/**
 * Images d'en-tête du diplôme officiel : logo IPAM (centre), emblème de Côte
 * d'Ivoire (droite) et logo du MESRS (gauche) — fichiers dédiés fournis pour
 * ce document, distincts de ceux du relevé de notes.
 */
export async function loadDiplomeHeaderImages(): Promise<DiplomeHeaderImages> {
  const [logoInstitut, embleme, ministere] = await Promise.all([
    loadPdfImg(LOGO_INSTITUT),
    loadPdfImg("/embleme.png"),
    loadPdfImg("/Logo_du_MESRS.png"),
  ]);
  return { logoInstitut, embleme, ministere };
}
