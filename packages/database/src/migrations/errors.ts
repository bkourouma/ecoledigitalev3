export type MigrationErrorCode =
  | "MIGRATION_FILE_INVALID"
  | "MIGRATION_CHECKSUM_MISMATCH"
  | "MIGRATION_MISSING_FILE"
  | "MIGRATION_OUT_OF_ORDER"
  | "MIGRATION_UNSAFE_DATABASE"
  | "MIGRATION_LOCK_TIMEOUT"
  | "MIGRATION_EXECUTION_FAILED"
  | "MIGRATION_OPTIONS_INVALID";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  constructor(code: MigrationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Fichier mal nommé, doublon de version, directive illisible… */
export class MigrationFileError extends MigrationError {
  constructor(message: string) {
    super("MIGRATION_FILE_INVALID", message);
  }
}

/** Un fichier déjà appliqué a changé : on refuse d'aller plus loin. */
export class MigrationChecksumError extends MigrationError {
  constructor(
    readonly mismatches: ReadonlyArray<{ version: string; name: string; applied: string; current: string }>,
  ) {
    super(
      "MIGRATION_CHECKSUM_MISMATCH",
      "Migration(s) déjà appliquée(s) modifiée(s) : " +
        mismatches.map((m) => `${m.version}_${m.name}`).join(", ") +
        ". Une migration appliquée est immuable : créez une nouvelle migration au lieu de modifier l'ancienne.",
    );
  }
}

/** Une migration enregistrée en base n'existe plus dans les dossiers fournis. */
export class MigrationMissingError extends MigrationError {
  constructor(readonly versions: readonly string[]) {
    super(
      "MIGRATION_MISSING_FILE",
      `Migration(s) appliquée(s) introuvable(s) dans les dossiers fournis : ${versions.join(", ")}. ` +
        "Vérifiez les --dir (tous les dossiers utilisés jusqu'ici sont requis).",
    );
  }
}

/** Une migration non appliquée porte un numéro inférieur à une migration déjà appliquée. */
export class MigrationOrderError extends MigrationError {
  constructor(readonly versions: readonly string[], readonly maxApplied: string) {
    super(
      "MIGRATION_OUT_OF_ORDER",
      `Migration(s) en retard sur l'historique (dernière appliquée : ${maxApplied}) : ${versions.join(", ")}. ` +
        "Renumérotez-les ou passez allowOutOfOrder / --allow-out-of-order en connaissance de cause.",
    );
  }
}

export class UnsafeDatabaseError extends MigrationError {
  constructor(readonly database: string) {
    super(
      "MIGRATION_UNSAFE_DATABASE",
      `Base "${database}" : son nom ne se termine pas par _test, _dev ou _local. ` +
        "Relancez avec --yes (option yes) pour confirmer explicitement que cette base doit être migrée.",
    );
  }
}

export class MigrationLockTimeoutError extends MigrationError {
  constructor(readonly waitedMs: number) {
    super(
      "MIGRATION_LOCK_TIMEOUT",
      `Verrou de migration non obtenu après ${waitedMs} ms : un autre runner est en cours d'exécution.`,
    );
  }
}

export class MigrationExecutionError extends MigrationError {
  constructor(
    readonly version: string,
    readonly filename: string,
    readonly line: number | undefined,
    cause: unknown,
    readonly transactional: boolean,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      "MIGRATION_EXECUTION_FAILED",
      `Échec de ${filename}${line ? ` (ligne ${line})` : ""} : ${reason}` +
        (transactional
          ? " — transaction annulée, rien n'a été enregistré."
          : " — fichier sans transaction : des effets partiels peuvent subsister, il doit être idempotent avant d'être relancé."),
      { cause },
    );
  }
}
