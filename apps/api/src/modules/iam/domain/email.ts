/** Normalisation des e-mails : l'unicité globale de l'identité repose dessus. */
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** NFKC + trim + minuscules. Ne touche pas aux alias `+tag` (légitimes, et différents côté fournisseur). */
export function normalizeEmail(input: string): string {
  return input.normalize("NFKC").trim().toLowerCase();
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function isPlausibleEmail(email: string): boolean {
  return email.length >= 3 && email.length <= 254 && !CONTROL.test(email) && EMAIL_RE.test(email);
}
