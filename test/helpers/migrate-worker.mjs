// Runs migrateUp or migrateDown in its own process, as a second app instance would.
// Usage: node migrate-worker.mjs <up|down> <migrations dir> <sqlite file>
import { createConnection, closeConnection } from "../../src/connection.js";
import { migrateUp, migrateDown } from "../../src/migrations/runner.js";

const [direction, dir, filename] = process.argv.slice(2);
const db = createConnection({ dialect: "sqlite", filename });
try {
  const result = direction === "up" ? await migrateUp(db, { dir }) : await migrateDown(db, { dir });
  process.stdout.write(JSON.stringify(result.applied ?? result.rolledBack));
} finally {
  await closeConnection(db);
}
