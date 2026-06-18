import { createClient } from "@libsql/client";

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

export async function initDb() {
  const db = getDb();

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
