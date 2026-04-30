import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency amounts in thousands
 * @param amount - The amount to format
 * @param currency - The currency symbol (default: 'XOF')
 * @returns Formatted string with amount in thousands
 */
export function formatCurrencyInThousands(amount: number, currency: string = 'XOF'): string {
  const amountInThousands = amount / 1000;
  return `${amountInThousands.toLocaleString()} k${currency}`;
}

/**
 * Format currency amounts in FCFA with proper thousand separators
 * @param amount - The amount to format
 * @returns Formatted string with amount in FCFA (e.g., "250 000 FCFA")
 */
export function formatAmountFCFA(amount: number): string {
  return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
}

/**
 * Convert thousands back to full amount for calculations
 * @param thousandsAmount - Amount in thousands
 * @returns Full amount
 */
export function convertThousandsToAmount(thousandsAmount: number): number {
  return thousandsAmount * 1000;
}

/**
 * Format file size in bytes to human-readable string
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "1.5 MB", "500 KB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}










