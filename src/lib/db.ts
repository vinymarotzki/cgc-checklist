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

  // Grupos das Atividades do CGC. Tabela independente do checklist: guarda só o
  // recorte de filtros repassado a GET /provider/messages da API SASI.
  // As colunas de filtro usam os mesmos nomes dos query params do contrato.
  // data_field_name/data_field_value não são params da API: são o roteamento
  // por campo da própria mensagem, aplicado depois do mapeamento.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_ids TEXT,
      team_name TEXT,
      channel_ids TEXT,
      app_ids TEXT,
      data_field_name TEXT,
      data_field_value TEXT,
      created_by_id TEXT,
      created_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  for (const column of ["data_field_name", "data_field_value"]) {
    try {
      await db.execute(`ALTER TABLE cgc_groups ADD COLUMN ${column} TEXT`);
    } catch {
      // Column already exists in older database schema, ignore.
    }
  }

  // Status das Atividades do CGC. O token de provider da API SASI só tem escopo
  // READ_MESSAGES, então o status é acompanhado aqui, do mesmo jeito que o
  // checklist acompanha o status das suas atividades.
  // A chave é o id da mensagem na API SASI.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_activity_status (
      message_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      group_id TEXT,
      user_id TEXT,
      user_name TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  try {
    await db.execute(`ALTER TABLE cgc_activity_status ADD COLUMN group_id TEXT`);
  } catch {
    // Column already exists in older database schema, ignore.
  }

  // Histórico das Atividades do CGC. Denormalizado de propósito: a mensagem
  // original vive na API SASI e pode mudar ou sair da janela de consulta, então
  // cada entrada guarda o retrato do que foi alterado.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_history (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      group_id TEXT,
      group_name TEXT,
      description TEXT,
      deadline TEXT,
      old_status TEXT,
      new_status TEXT,
      observation TEXT,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_history_created ON cgc_history (created_at DESC)`
  );

  // Prioridade deixou de ser um recurso do produto; remove a coluna (e o dado
  // já gravado) de bancos que ainda vieram do schema antigo.
  try {
    await db.execute(`ALTER TABLE cgc_history DROP COLUMN priority`);
  } catch {
    // Coluna já removida ou banco criado depois dessa migração, ignora.
  }

  // Comentários das Atividades do CGC. Tabela separada de `observations` de
  // propósito: aquela rota grava em `history`, e /history faz LEFT JOIN com
  // `activities` — um comentário do CGC viraria linha órfã na tela do checklist.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_observations (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_observations_message ON cgc_observations (message_id)`
  );

  // Total "solicitado" por grupo, sincronizado da API SASI (ver group-totals.ts).
  // `last_message_id` é a marca d'água: só mensagens mais novas que ela entram
  // na próxima sincronização, em vez de escanear o canal inteiro de novo.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_group_totals (
      group_id TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0,
      last_message_id INTEGER,
      updated_at TEXT NOT NULL
    )
  `);

  // Cache local das atividades do CGC já mapeadas (ver message-cache.ts).
  // Mesma ideia de cgc_group_totals: sincroniza incrementalmente a partir do
  // last_message_id, mas guarda a atividade inteira (não só a contagem), pra
  // busca/filtro/paginação da listagem lerem daqui em vez de escanear a API
  // SASI a cada request.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_message_cache (
      message_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_cgc_message_cache_group ON cgc_message_cache (group_id)`
  );

  // Marca d'água + TTL da sincronização do cache acima. Tabela própria (em vez
  // de reusar cgc_group_totals) porque a contagem "solicitada" da tela de
  // seleção e o cache de atividades têm cadências diferentes — uma escreveria
  // por cima do watermark da outra se dividissem a mesma linha.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cgc_message_cache_sync (
      group_id TEXT PRIMARY KEY,
      last_message_id INTEGER,
      synced_at TEXT NOT NULL
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
