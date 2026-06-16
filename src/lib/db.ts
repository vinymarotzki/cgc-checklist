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
}
