/**
 * Enrollment Number Generation Utility
 * 
 * Utility functions for generating unique enrollment numbers.
 * Format: INS-DATA-YYYYMMDD-XXX (e.g., INS-DATA-20251120-001)
 */

/**
 * Generate enrollment number format string
 * @param date Optional date to use (defaults to today)
 * @returns Format string for enrollment number
 */
export function getEnrollmentNumberFormat(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `INS-DATA-${year}${month}${day}-XXX`;
}

/**
 * Parse enrollment number to extract date and sequence
 * @param enrollmentNumber Enrollment number to parse
 * @returns Parsed enrollment data or null if invalid format
 */
export function parseEnrollmentNumber(enrollmentNumber: string): {
  date: Date;
  sequence: number;
} | null {
  const match = enrollmentNumber.match(/^INS-DATA-(\d{4})(\d{2})(\d{2})-(\d+)$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, sequence] = match;
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));

  return {
    date,
    sequence: parseInt(sequence, 10),
  };
}

/**
 * Validate enrollment number format
 * @param enrollmentNumber Enrollment number to validate
 * @returns true if format is valid, false otherwise
 */
export function isValidEnrollmentNumberFormat(enrollmentNumber: string): boolean {
  return /^INS-DATA-\d{8}-\d{3}$/.test(enrollmentNumber);
}

