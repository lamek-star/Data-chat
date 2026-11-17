// Minimal Cloudflare D1 stand-in for tests, on Node's built-in SQLite.
// D1 is SQLite, so migrations/*.sql run unchanged. Implements the subset of
// the D1 API the Worker uses: prepare().bind().first() / all() / run().
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../../migrations/", import.meta.url));

export function createTestD1(migrationsDir = MIGRATIONS) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort())
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));

  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => {
      const row = db.prepare(sql).get(...args);
      return row ? { ...row } : null;
    },
    all: async () => ({ results: db.prepare(sql).all(...args).map((row) => ({ ...row })) }),
    run: async () => {
      const result = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  });
  return { prepare: (sql) => statement(sql), raw: db };
}
