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
export declare function describePlan(plan: import('./diff.js').DiffPlan): string[];
