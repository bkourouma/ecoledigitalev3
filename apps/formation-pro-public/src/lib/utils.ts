export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatCurrency(value: number | string | null | undefined) {
  const amount =
    typeof value === "number" ? value : value ? Number.parseFloat(value) : 0;

  return `${new Intl.NumberFormat("fr-FR").format(Number.isFinite(amount) ? amount : 0)} FCFA`;
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Date non disponible";
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return "Date invalide";

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function getInitials(firstName?: string | null, lastName?: string | null) {
  return [firstName?.[0], lastName?.[0]].filter(Boolean).join("").toUpperCase() || "FP";
}

export function absoluteUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
