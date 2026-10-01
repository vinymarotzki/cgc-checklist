import { createClient } from "@libsql/client";
import { v4 as uuidv4 } from "uuid";

let client: ReturnType<typeof createClient> | null = null;

export function getDb() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error("TURSO_DATABASE_URL is not defined");
    }

    client = createClient({
      url,
      authToken: authToken || undefined,
    });
  }
  return client;
}

async function runMigrations() {
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS checklists (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_by_id TEXT,
      created_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      activity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SEM_STATUS',
      responsible TEXT,
      observation TEXT
    )
  `);

  try {
    await db.execute(`ALTER TABLE activities ADD COLUMN checklist_id TEXT REFERENCES checklists(id)`);
  } catch {
    // Column already exists in older database schema, ignore.
  }

  const legacyActivities = await db.execute(`
    SELECT COUNT(*) AS total
    FROM activities
    WHERE checklist_id IS NULL
  `);
  const legacyTotal = Number(legacyActivities.rows[0]?.total || 0);

  if (legacyTotal > 0) {
    const checklistId = uuidv4();
    await db.execute({
      sql: `INSERT INTO checklists (id, title, created_by_id, created_by_name, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [checklistId, "Checklist existente", null, "Sistema", new Date().toISOString()],
    });
    await db.execute({
      sql: "UPDATE activities SET checklist_id = ? WHERE checklist_id IS NULL",
      args: [checklistId],
    });
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      user_id TEXT,
      user_name TEXT,
      observation TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS completed_checklists (
      id TEXT PRIMARY KEY,
      name TEXT,
      user_id TEXT,
      user_name TEXT,
      total_items INTEGER,
      completed_items INTEGER,
      created_at TEXT NOT NULL,
      completed_at TEXT NOT NULL
    )
  `);

  try {
    await db.execute(`ALTER TABLE completed_checklists ADD COLUMN name TEXT`);
  } catch {
    // Column already exists in older database schema, ignore.
  }

  try {
    await db.execute(`ALTER TABLE completed_checklists ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  } catch {
    // Column already exists in older database schema, ignore.
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS completed_checklist_items (
      id TEXT PRIMARY KEY,
      checklist_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      responsible TEXT,
      observation TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      text TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

}

/**
 * `initDb` é chamada no topo de toda rota e de toda função de lib que toca o
 * banco — sem memoização isso reexecutava a migração inteira (~20 statements
 * contra o Turso remoto) várias vezes por request. Memoizado no processo:
 * a migração roda uma vez só; falha limpa o cache pra poder tentar de novo na
 * próxima chamada em vez de deixar o processo permanentemente quebrado.
 */
let dbReadyPromise: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (!dbReadyPromise) {
    dbReadyPromise = runMigrations().catch((error) => {
      dbReadyPromise = null;
      throw error;
    });
  }
  return dbReadyPromise;
}
