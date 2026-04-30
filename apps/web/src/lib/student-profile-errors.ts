export const STUDENT_PROFILE_MISSING_MESSAGE =
  "Ce compte n'est pas encore rattache a une fiche etudiant. Veuillez contacter l'administrateur.";

type StudentApiErrorPayload = {
  error?: string;
  message?: string;
  details?: {
    error?: string;
    message?: string;
  };
};

export async function getStudentApiError(
  response: Response,
  fallbackMessage: string,
): Promise<Error> {
  const errorText = await response.text();
  let errorData: StudentApiErrorPayload = {};

  if (errorText) {
    try {
      errorData = JSON.parse(errorText) as StudentApiErrorPayload;
    } catch {
      errorData = { message: errorText };
    }
  }

  const detailMessage = errorData.details?.message;
  const detailError = errorData.details?.error;
  const normalizedMessage = [
    errorData.error,
    errorData.message,
    detailError,
    detailMessage,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    response.status === 404 &&
    (normalizedMessage.includes("student not found") ||
      normalizedMessage.includes("no student profile found") ||
      normalizedMessage.includes("student record not found"))
  ) {
    return new Error(STUDENT_PROFILE_MISSING_MESSAGE);
  }

  return new Error(
    detailMessage || errorData.message || detailError || errorData.error || fallbackMessage,
  );
}

export function isStudentProfileMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();

  return (
    normalizedMessage === STUDENT_PROFILE_MISSING_MESSAGE.toLowerCase() ||
    normalizedMessage.includes("student not found") ||
    normalizedMessage.includes("no student profile found") ||
    normalizedMessage.includes("student record not found")
  );
}
