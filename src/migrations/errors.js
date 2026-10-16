/**
 * Thrown by generateMigration() when a plan contains destructive
 * operations (dropping a model, dropping a field) that weren't
 * explicitly allowed via `{ allowDestructive: true }`, or unresolved
 * field-type changes that Phase 6 refuses to auto-generate ALTER
 * statements for. This is the central safety gate for this phase:
 * nothing destructive is ever silently applied.
 */
export class MigrationSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationSafetyError";
  }
}

/**
 * Thrown by the migration runner when the migrations on disk and the
 * migrations recorded as applied in the database can't be reconciled
 * safely - pending migrations blocking a generate, an applied
 * migration whose file is gone, a new file that sorts before one
 * already applied. Every one of these means the recorded "before"
 * state a migration was generated against may no longer be true, so
 * the runner stops rather than guess.
 */
export class MigrationStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationStateError";
  }
}
