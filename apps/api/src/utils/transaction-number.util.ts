/**
 * Transaction Number Generation Utility
 * 
 * Utility functions for generating unique payment transaction numbers.
 * Format: TXN-YYYYMMDDHHMMSS-XXXXX (e.g., TXN-20251120143025-ABC12)
 */

/**
 * Generate transaction number format string
 * @param date Optional date to use (defaults to now)
 * @returns Format string for transaction number
 */
export function getTransactionNumberFormat(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `TXN-${year}${month}${day}${hours}${minutes}${seconds}-XXXXX`;
}

/**
 * Generate a random suffix for transaction number
 * @param length Length of suffix (default: 5)
 * @returns Random alphanumeric suffix
 */
export function generateTransactionSuffix(length: number = 5): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a complete transaction number
 * @param date Optional date to use (defaults to now)
 * @returns Complete transaction number
 */
export function generateTransactionNumber(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const suffix = generateTransactionSuffix(5);
  return `TXN-${year}${month}${day}${hours}${minutes}${seconds}-${suffix}`;
}

/**
 * Parse transaction number to extract date and suffix
 * @param transactionNumber Transaction number to parse
 * @returns Parsed transaction data or null if invalid format
 */
export function parseTransactionNumber(transactionNumber: string): {
  date: Date;
  suffix: string;
} | null {
  const match = transactionNumber.match(/^TXN-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-(.+)$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds, suffix] = match;
  const date = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hours, 10),
    parseInt(minutes, 10),
    parseInt(seconds, 10)
  );

  return {
    date,
    suffix,
  };
}

/**
 * Validate transaction number format
 * @param transactionNumber Transaction number to validate
 * @returns true if format is valid, false otherwise
 */
export function isValidTransactionNumberFormat(transactionNumber: string): boolean {
  return /^TXN-\d{14}-[A-Z0-9]{5}$/.test(transactionNumber);
}

