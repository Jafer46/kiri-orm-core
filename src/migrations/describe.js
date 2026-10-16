/**
 * Renders a `DiffPlan` (from diffSchema) into human-readable lines,
 * prefixed so destructive/ambiguous items are impossible to miss when
 * reviewing before applying. This is the "dry-run" preview the
 * roadmap calls for - the plan itself is already inert data, this
 * just formats it for a human (or a future CLI) to review.
 *
 * @param {import('./diff.js').DiffPlan} plan
 * @returns {string[]}
 */
export function describePlan(plan) {
  const lines = [];

  for (const modelName of plan.createModels) {
    lines.push(`[safe]        create model "${modelName}"`);
  }

  for (const rename of plan.renameModels) {
    lines.push(
      `[safe]        rename table "${rename.fromTable}" -> "${rename.toTable}" (model "${rename.modelName}")`
    );
  }

  for (const drop of plan.dropModels) {
    lines.push(`[DESTRUCTIVE] drop model "${drop.modelName}" (table "${drop.tableName}") - all rows will be lost`);
  }

  if (plan.possibleModelRenames) {
    lines.push(
      `[ambiguous]   possible model rename: removed [${plan.possibleModelRenames.removed.join(", ")}], ` +
        `added [${plan.possibleModelRenames.added.join(", ")}] - pass \`modelRenames\` to resolve, ` +
        `otherwise these are treated as an unrelated drop + create`
    );
  }

  for (const [modelName, changes] of Object.entries(plan.fieldChanges)) {
    for (const fieldName of changes.addFields) {
      lines.push(`[safe]        ${modelName}: add field "${fieldName}"`);
    }
    for (const rename of changes.renameFields) {
      lines.push(
        `[safe]        ${modelName}: rename field "${rename.from}" -> "${rename.to}" ` +
          `(column "${rename.fromColumn}" -> "${rename.toColumn}")`
      );
    }
    for (const rename of changes.columnRenames) {
      lines.push(
        `[safe]        ${modelName}: rename column "${rename.fromColumn}" -> "${rename.toColumn}" ` +
          `(field "${rename.fieldName}" unchanged)`
      );
    }
    for (const drop of changes.dropFields) {
      lines.push(
        `[DESTRUCTIVE] ${modelName}: drop field "${drop.fieldName}" (column "${drop.columnName}") - data will be lost`
      );
    }
    for (const change of changes.typeChanges) {
      lines.push(
        `[MANUAL]      ${modelName}: field "${change.fieldName}" type changed ${change.from} -> ${change.to} - ` +
          `not auto-migrated, resolve manually`
      );
    }
    if (changes.possibleFieldRenames) {
      lines.push(
        `[ambiguous]   ${modelName}: possible field rename: removed [${changes.possibleFieldRenames.removed.join(", ")}], ` +
          `added [${changes.possibleFieldRenames.added.join(", ")}] - pass \`fieldRenames\` to resolve, ` +
          `otherwise these are treated as an unrelated drop + add`
      );
    }
  }

  if (lines.length === 0) {
    lines.push("(no changes - registry matches the last synced state)");
  }

  return lines;
}
