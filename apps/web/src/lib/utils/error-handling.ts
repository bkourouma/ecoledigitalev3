/**
 * Comprehensive error handling utilities for the assignment submission system
 */

export interface AppError {
  code: string;
  message: string;
  details?: any;
  userMessage: string;
  retryable: boolean;
}

export class AssignmentError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly retryable: boolean;
  public readonly details?: any;

  constructor(code: string, message: string, userMessage: string, retryable = false, details?: any) {
    super(message);
    this.name = 'AssignmentError';
    this.code = code;
    this.userMessage = userMessage;
    this.retryable = retryable;
    this.details = details;
  }
}

// Error codes and their corresponding user messages
export const ERROR_CODES = {
  // Network errors
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    userMessage: 'Problème de connexion. Vérifiez votre connexion internet et réessayez.',
    retryable: true,
  },
  TIMEOUT_ERROR: {
    code: 'TIMEOUT_ERROR',
    userMessage: 'La requête a pris trop de temps. Veuillez réessayer.',
    retryable: true,
  },
  SERVER_ERROR: {
    code: 'SERVER_ERROR',
    userMessage: 'Erreur du serveur. Veuillez réessayer dans quelques instants.',
    retryable: true,
  },

  // Authentication errors
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    userMessage: 'Votre session a expiré. Veuillez vous reconnecter.',
    retryable: false,
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    userMessage: 'Vous n\'avez pas les permissions nécessaires pour cette action.',
    retryable: false,
  },

  // Assignment errors
  ASSIGNMENT_NOT_FOUND: {
    code: 'ASSIGNMENT_NOT_FOUND',
    userMessage: 'Ce devoir n\'existe pas ou vous n\'y avez pas accès.',
    retryable: false,
  },
  ASSIGNMENT_EXPIRED: {
    code: 'ASSIGNMENT_EXPIRED',
    userMessage: 'La date limite de ce devoir est dépassée.',
    retryable: false,
  },
  ASSIGNMENT_NOT_PUBLISHED: {
    code: 'ASSIGNMENT_NOT_PUBLISHED',
    userMessage: 'Ce devoir n\'est pas encore disponible.',
    retryable: false,
  },

  // Submission errors
  SUBMISSION_NOT_FOUND: {
    code: 'SUBMISSION_NOT_FOUND',
    userMessage: 'Aucune soumission trouvée pour ce devoir.',
    retryable: false,
  },
  SUBMISSION_ALREADY_SUBMITTED: {
    code: 'SUBMISSION_ALREADY_SUBMITTED',
    userMessage: 'Ce devoir a déjà été soumis et ne peut plus être modifié.',
    retryable: false,
  },
  SUBMISSION_LIMIT_EXCEEDED: {
    code: 'SUBMISSION_LIMIT_EXCEEDED',
    userMessage: 'Vous avez atteint le nombre maximum de tentatives pour ce devoir.',
    retryable: false,
  },
  LATE_SUBMISSION_NOT_ALLOWED: {
    code: 'LATE_SUBMISSION_NOT_ALLOWED',
    userMessage: 'Les soumissions en retard ne sont pas autorisées pour ce devoir.',
    retryable: false,
  },

  // File upload errors
  FILE_TOO_LARGE: {
    code: 'FILE_TOO_LARGE',
    userMessage: 'Le fichier est trop volumineux. Taille maximale autorisée dépassée.',
    retryable: false,
  },
  FILE_TYPE_NOT_ALLOWED: {
    code: 'FILE_TYPE_NOT_ALLOWED',
    userMessage: 'Type de fichier non autorisé. Vérifiez les formats acceptés.',
    retryable: false,
  },
  FILE_UPLOAD_FAILED: {
    code: 'FILE_UPLOAD_FAILED',
    userMessage: 'Échec du téléchargement du fichier. Veuillez réessayer.',
    retryable: true,
  },
  FILE_CORRUPTED: {
    code: 'FILE_CORRUPTED',
    userMessage: 'Le fichier semble être corrompu. Veuillez sélectionner un autre fichier.',
    retryable: false,
  },

  // Validation errors
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    userMessage: 'Les données saisies ne sont pas valides. Veuillez vérifier et corriger.',
    retryable: false,
  },
  TEXT_TOO_SHORT: {
    code: 'TEXT_TOO_SHORT',
    userMessage: 'Le texte est trop court. Respectez la longueur minimale requise.',
    retryable: false,
  },
  TEXT_TOO_LONG: {
    code: 'TEXT_TOO_LONG',
    userMessage: 'Le texte est trop long. Respectez la longueur maximale autorisée.',
    retryable: false,
  },
  REQUIRED_FIELD_MISSING: {
    code: 'REQUIRED_FIELD_MISSING',
    userMessage: 'Certains champs obligatoires ne sont pas remplis.',
    retryable: false,
  },

  // Evaluation errors
  EVALUATION_TIME_EXPIRED: {
    code: 'EVALUATION_TIME_EXPIRED',
    userMessage: 'Le temps imparti pour cette évaluation est écoulé.',
    retryable: false,
  },
  EVALUATION_NOT_STARTED: {
    code: 'EVALUATION_NOT_STARTED',
    userMessage: 'L\'évaluation n\'a pas encore commencé.',
    retryable: false,
  },
  INVALID_ANSWER_FORMAT: {
    code: 'INVALID_ANSWER_FORMAT',
    userMessage: 'Format de réponse invalide pour cette question.',
    retryable: false,
  },

  // Generic errors
  UNKNOWN_ERROR: {
    code: 'UNKNOWN_ERROR',
    userMessage: 'Une erreur inattendue s\'est produite. Veuillez réessayer.',
    retryable: true,
  },
} as const;

/**
 * Parse and normalize errors from different sources
 */
export function parseError(error: any): AssignmentError {
  // Handle AssignmentError instances
  if (error instanceof AssignmentError) {
    return error;
  }

  // Handle fetch/network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return new AssignmentError(
      ERROR_CODES.NETWORK_ERROR.code,
      error.message,
      ERROR_CODES.NETWORK_ERROR.userMessage,
      ERROR_CODES.NETWORK_ERROR.retryable
    );
  }

  // Handle HTTP response errors
  if (error.status) {
    switch (error.status) {
      case 401:
        return new AssignmentError(
          ERROR_CODES.UNAUTHORIZED.code,
          'Unauthorized',
          ERROR_CODES.UNAUTHORIZED.userMessage,
          ERROR_CODES.UNAUTHORIZED.retryable
        );
      case 403:
        return new AssignmentError(
          ERROR_CODES.FORBIDDEN.code,
          'Forbidden',
          ERROR_CODES.FORBIDDEN.userMessage,
          ERROR_CODES.FORBIDDEN.retryable
        );
      case 404:
        return new AssignmentError(
          ERROR_CODES.ASSIGNMENT_NOT_FOUND.code,
          'Not Found',
          ERROR_CODES.ASSIGNMENT_NOT_FOUND.userMessage,
          ERROR_CODES.ASSIGNMENT_NOT_FOUND.retryable
        );
      case 408:
        return new AssignmentError(
          ERROR_CODES.TIMEOUT_ERROR.code,
          'Request Timeout',
          ERROR_CODES.TIMEOUT_ERROR.userMessage,
          ERROR_CODES.TIMEOUT_ERROR.retryable
        );
      case 413:
        return new AssignmentError(
          ERROR_CODES.FILE_TOO_LARGE.code,
          'Payload Too Large',
          ERROR_CODES.FILE_TOO_LARGE.userMessage,
          ERROR_CODES.FILE_TOO_LARGE.retryable
        );
      case 415:
        return new AssignmentError(
          ERROR_CODES.FILE_TYPE_NOT_ALLOWED.code,
          'Unsupported Media Type',
          ERROR_CODES.FILE_TYPE_NOT_ALLOWED.userMessage,
          ERROR_CODES.FILE_TYPE_NOT_ALLOWED.retryable
        );
      case 422:
        return new AssignmentError(
          ERROR_CODES.VALIDATION_ERROR.code,
          'Validation Error',
          ERROR_CODES.VALIDATION_ERROR.userMessage,
          ERROR_CODES.VALIDATION_ERROR.retryable
        );
      case 500:
      case 502:
      case 503:
      case 504:
        return new AssignmentError(
          ERROR_CODES.SERVER_ERROR.code,
          'Server Error',
          ERROR_CODES.SERVER_ERROR.userMessage,
          ERROR_CODES.SERVER_ERROR.retryable
        );
    }
  }

  // Handle specific error messages from API
  if (typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    
    if (message.includes('assignment not found')) {
      return new AssignmentError(
        ERROR_CODES.ASSIGNMENT_NOT_FOUND.code,
        error.message,
        ERROR_CODES.ASSIGNMENT_NOT_FOUND.userMessage,
        ERROR_CODES.ASSIGNMENT_NOT_FOUND.retryable
      );
    }
    
    if (message.includes('deadline') || message.includes('expired')) {
      return new AssignmentError(
        ERROR_CODES.ASSIGNMENT_EXPIRED.code,
        error.message,
        ERROR_CODES.ASSIGNMENT_EXPIRED.userMessage,
        ERROR_CODES.ASSIGNMENT_EXPIRED.retryable
      );
    }
    
    if (message.includes('already submitted')) {
      return new AssignmentError(
        ERROR_CODES.SUBMISSION_ALREADY_SUBMITTED.code,
        error.message,
        ERROR_CODES.SUBMISSION_ALREADY_SUBMITTED.userMessage,
        ERROR_CODES.SUBMISSION_ALREADY_SUBMITTED.retryable
      );
    }
    
    if (message.includes('file too large') || message.includes('size')) {
      return new AssignmentError(
        ERROR_CODES.FILE_TOO_LARGE.code,
        error.message,
        ERROR_CODES.FILE_TOO_LARGE.userMessage,
        ERROR_CODES.FILE_TOO_LARGE.retryable
      );
    }
    
    if (message.includes('file type') || message.includes('format')) {
      return new AssignmentError(
        ERROR_CODES.FILE_TYPE_NOT_ALLOWED.code,
        error.message,
        ERROR_CODES.FILE_TYPE_NOT_ALLOWED.userMessage,
        ERROR_CODES.FILE_TYPE_NOT_ALLOWED.retryable
      );
    }
    
    if (message.includes('time expired') || message.includes('timeout')) {
      return new AssignmentError(
        ERROR_CODES.EVALUATION_TIME_EXPIRED.code,
        error.message,
        ERROR_CODES.EVALUATION_TIME_EXPIRED.userMessage,
        ERROR_CODES.EVALUATION_TIME_EXPIRED.retryable
      );
    }
  }

  // Default to unknown error
  return new AssignmentError(
    ERROR_CODES.UNKNOWN_ERROR.code,
    error.message || 'Unknown error',
    ERROR_CODES.UNKNOWN_ERROR.userMessage,
    ERROR_CODES.UNKNOWN_ERROR.retryable,
    error
  );
}

/**
 * Validate file before upload
 */
export function validateFile(
  file: File,
  maxSizeMB: number,
  allowedTypes: string[]
): AssignmentError | null {
  // Check file size
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return new AssignmentError(
      ERROR_CODES.FILE_TOO_LARGE.code,
      `File size ${file.size} exceeds maximum ${maxSizeBytes}`,
      `Le fichier est trop volumineux (${(file.size / 1024 / 1024).toFixed(1)}MB). Taille maximale: ${maxSizeMB}MB.`,
      false,
      { fileSize: file.size, maxSize: maxSizeBytes }
    );
  }

  // Check file type
  const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!allowedTypes.includes(fileExtension)) {
    return new AssignmentError(
      ERROR_CODES.FILE_TYPE_NOT_ALLOWED.code,
      `File type ${fileExtension} not allowed`,
      `Type de fichier non autorisé (${fileExtension}). Types acceptés: ${allowedTypes.join(', ')}.`,
      false,
      { fileType: fileExtension, allowedTypes }
    );
  }

  return null;
}

/**
 * Validate text response
 */
export function validateTextResponse(
  text: string,
  minLength: number,
  maxLength: number
): AssignmentError | null {
  const trimmedText = text.trim();
  
  if (trimmedText.length < minLength) {
    return new AssignmentError(
      ERROR_CODES.TEXT_TOO_SHORT.code,
      `Text length ${trimmedText.length} is below minimum ${minLength}`,
      `Le texte est trop court (${trimmedText.length} caractères). Minimum requis: ${minLength} caractères.`,
      false,
      { textLength: trimmedText.length, minLength }
    );
  }
  
  if (trimmedText.length > maxLength) {
    return new AssignmentError(
      ERROR_CODES.TEXT_TOO_LONG.code,
      `Text length ${trimmedText.length} exceeds maximum ${maxLength}`,
      `Le texte est trop long (${trimmedText.length} caractères). Maximum autorisé: ${maxLength} caractères.`,
      false,
      { textLength: trimmedText.length, maxLength }
    );
  }
  
  return null;
}

/**
 * Check if assignment deadline has passed
 */
export function checkAssignmentDeadline(
  dueDate: string,
  allowLateSubmissions: boolean = false
): AssignmentError | null {
  const now = new Date();
  const deadline = new Date(dueDate);
  
  if (now > deadline && !allowLateSubmissions) {
    return new AssignmentError(
      ERROR_CODES.LATE_SUBMISSION_NOT_ALLOWED.code,
      `Assignment deadline ${dueDate} has passed`,
      `La date limite de soumission est dépassée (${deadline.toLocaleDateString('fr-FR')}). Les soumissions en retard ne sont pas autorisées.`,
      false,
      { deadline: dueDate, currentTime: now.toISOString() }
    );
  }
  
  return null;
}

/**
 * Retry mechanism for retryable errors
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: AssignmentError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = parseError(error);
      
      if (!lastError.retryable || attempt === maxRetries) {
        throw lastError;
      }
      
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
    }
  }
  
  throw lastError!;
}

/**
 * Log errors for monitoring and debugging
 */
export function logError(error: AssignmentError, context?: any): void {
  const errorInfo = {
    code: error.code,
    message: error.message,
    userMessage: error.userMessage,
    retryable: error.retryable,
    details: error.details,
    context,
    timestamp: new Date().toISOString(),
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'server',
    url: typeof window !== 'undefined' ? window.location.href : 'server',
  };
  
  // In development, log to console
  if (process.env.NODE_ENV === 'development') {
    console.error('Assignment Error:', errorInfo);
  }
  
  // In production, send to monitoring service
  // This would integrate with services like Sentry, LogRocket, etc.
  if (process.env.NODE_ENV === 'production') {
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }
}
