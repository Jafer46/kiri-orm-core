import { generateMigration } from "./generate.js";
import {
  planMigrationForeignKeys,
  renderForeignKey,
} from "./foreign-keys-plan.js";

const json = (value) => JSON.stringify(value);
const indent = (text, spaces) =>
  text
    .split("\n")
    .map((line) => (line ? " ".repeat(spaces) + line : line))
    .join("\n");

/**
 * Renders a `DiffPlan` as the source of a standalone ESM migration
 * file - the on-disk counterpart of generateMigration()'s in-memory
 * `up`/`down`, for a migration workflow that has to survive between
 * runs.
 *
 * The file is meant to be read, reviewed and, if needed, edited:
 *
 *   export const summary  - the describePlan() lines, for logs and review
 *   export async function up(db, helpers)
 *   export async function down(db, helpers)
 *   export const meta     - per touched model, the `_meta_*` snapshot
 *                           before and after (see meta/snapshot.js);
 *                           applied/rolled back with the schema change
 *
 * It is self-contained on purpose. Every field descriptor a change
 * needs is embedded, so the file keeps meaning the same thing after
 * the models it was generated from have changed again. It imports
 * nothing: the column-building helpers arrive as `up`/`down`'s second
 * argument, so the file runs wherever it is loaded from (the runner
 * in ./runner.js supplies them) without needing `@kiri-orm/core` to
 * resolve from the migrations directory.
 *
 * The safety rules are exactly generateMigration()'s, because this
 * calls it first: a plan with destructive operations throws
 * `MigrationSafetyError` unless `allowDestructive` is set, and field
 * type changes always throw.
 *
 * @param {import('./diff.js').DiffPlan} plan
 * @param {import('../models/registry.js').ModelRegistry} modelRegistry
 * @param {Object} [options]
 * @param {boolean} [options.allowDestructive]
 * @param {Record<string, { before: object|null, after: object|null }>} [options.meta]
 * @param {string} [options.header] - text for the leading comment
 * @returns {string}
 * @throws {import('./errors.js').MigrationSafetyError}
 */
export function renderMigrationSource(plan, modelRegistry, options = {}) {
  const { summary } = generateMigration(plan, modelRegistry, {
    allowDestructive: options.allowDestructive,
  });

  const keys = planMigrationForeignKeys(plan, modelRegistry);
  const createTable = (tableName, entries, foreignKeys = []) => {
    const columns = entries.map(
      ([column, field]) =>
        `  buildColumn(table, ${json(column)}, ${json(field)}, columnBuilderRegistry);`,
    );
    return [
      `await db.schema.createTable(${json(tableName)}, (table) => {`,
      ...columns,
      ...foreignKeys.map((fk) => `  ${renderForeignKey(fk)}`),
      `});`,
    ];
  };
  const alterWith = (tableName, lines) => [
    `await db.schema.alterTable(${json(tableName)}, (table) => {`,
    ...lines.map((l) => `  ${l}`),
    `});`,
  ];
  const modelEntries = (model) =>
    Object.entries(model.fields).map(([fieldName, field]) => [
      model.columns[fieldName],
      field,
    ]);

  const up = [];
  for (const rename of plan.renameModels) {
    up.push(
      `await db.schema.renameTable(${json(rename.fromTable)}, ${json(rename.toTable)});`,
    );
  }
  // new tables in dependency order, each with its foreign keys inside the CREATE TABLE
  for (const model of keys.creation.order) {
    up.push(
      ...createTable(
        model.tableName,
        modelEntries(model),
        keys.creation.inline.get(model.name),
      ),
    );
  }
  for (const { model, fk } of keys.creation.deferred)
    up.push(...alterWith(model.tableName, [renderForeignKey(fk)]));
  for (const [modelName, changes] of Object.entries(plan.fieldChanges)) {
    const model = modelRegistry.getModel(modelName);
    const body = [];
    for (const rename of [...changes.renameFields, ...changes.columnRenames]) {
      body.push(
        `table.renameColumn(${json(rename.fromColumn)}, ${json(rename.toColumn)});`,
      );
    }
    for (const fieldName of changes.addFields) {
      body.push(
        `buildColumn(table, ${json(model.columns[fieldName])}, ${json(model.fields[fieldName])}, columnBuilderRegistry);`,
      );
    }
    for (const fk of keys.added[modelName] ?? [])
      body.push(renderForeignKey(fk));
    for (const drop of changes.dropFields)
      body.push(`table.dropColumn(${json(drop.columnName)});`);
    up.push(
      `await db.schema.alterTable(${json(model.tableName)}, (table) => {`,
      ...body.map((l) => `  ${l}`),
      `});`,
    );
  }
  for (const drop of plan.dropModels)
    up.push(`await db.schema.dropTable(${json(drop.tableName)});`);

  const down = [];
  for (const drop of [...plan.dropModels].reverse()) {
    down.push(
      ...createTable(
        drop.tableName,
        Object.entries(drop.fields).map(([f, field]) => [
          drop.columns[f],
          field,
        ]),
      ),
    );
  }
  for (const [modelName, changes] of Object.entries(
    plan.fieldChanges,
  ).reverse()) {
    const model = modelRegistry.getModel(modelName);
    const body = [];
    for (const drop of changes.dropFields) {
      body.push(
        `buildColumn(table, ${json(drop.columnName)}, ${json(drop.field)}, columnBuilderRegistry);`,
      );
    }
    for (const fk of keys.added[modelName] ?? [])
      body.push(`table.dropForeign(${json(fk.column)});`);
    for (const fieldName of changes.addFields)
      body.push(`table.dropColumn(${json(model.columns[fieldName])});`);
    for (const rename of [...changes.columnRenames, ...changes.renameFields]) {
      body.push(
        `table.renameColumn(${json(rename.toColumn)}, ${json(rename.fromColumn)});`,
      );
    }
    down.push(
      `await db.schema.alterTable(${json(model.tableName)}, (table) => {`,
      ...body.map((l) => `  ${l}`),
      `});`,
    );
  }
  for (const { model, fk } of [...keys.creation.deferred].reverse())
    down.push(
      ...alterWith(model.tableName, [`table.dropForeign(${json(fk.column)});`]),
    );
  for (const model of [...keys.creation.order].reverse()) {
    down.push(`await db.schema.dropTable(${json(model.tableName)});`);
  }
  for (const rename of [...plan.renameModels].reverse()) {
    down.push(
      `await db.schema.renameTable(${json(rename.toTable)}, ${json(rename.fromTable)});`,
    );
  }

  const fn = (name, lines) =>
    [
      `export async function ${name}(db, { buildColumn, columnBuilderRegistry }) {`,
      indent(lines.join("\n"), 2),
      `}`,
    ].join("\n");

  return [
    `// ${options.header ?? "Generated by `orm migrate:generate`."}`,
    `// Review before applying; up()/down() are plain Knex schema-builder code and safe to edit.`,
    `// Reversibility is schema-level: rolling back a dropped table or column restores its shape, not its rows.`,
    ``,
    `export const summary = ${json(summary)};`,
    ``,
    fn("up", up),
    ``,
    fn("down", down),
    ``,
    `// Metadata (_meta_models/_meta_fields) before and after this migration, restored in the same`,
    `// transaction as the schema change so the recorded schema never drifts from the real one.`,
    `export const meta = ${JSON.stringify(options.meta ?? {}, null, 2)};`,
    ``,
  ].join("\n");
}
