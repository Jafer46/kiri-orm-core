/**
 * Thrown when a field type has no registered column builder, or when
 * sync() encounters a schema-level problem it can't resolve safely
 * (e.g. a column exists with an incompatible shape it wasn't told how
 * to reconcile - additive-only sync never attempts to fix that itself).
 */
export class SchemaSyncError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaSyncError";
  }
}
