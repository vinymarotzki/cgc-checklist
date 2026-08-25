// scripts/migrate-cgc-data.mjs
//
// Copia as tabelas cgc_* do banco Turso de origem (checklist, hoje com
// tudo junto) pro banco Turso de destino (cgc-atividades, novo). Idempotente:
// usa INSERT OR REPLACE, então pode rodar de novo sem duplicar linhas.
//
// Uso:
//   SOURCE_TURSO_DATABASE_URL=... SOURCE_TURSO_AUTH_TOKEN=... \
//   DEST_TURSO_DATABASE_URL=...   DEST_TURSO_AUTH_TOKEN=...   \
//   node scripts/migrate-cgc-data.mjs [--dry-run]

import { createClient } from "@libsql/client";

const dryRun = process.argv.includes("--dry-run");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não definida`);
  return value;
}

const source = createClient({
  url: requireEnv("SOURCE_TURSO_DATABASE_URL"),
  authToken: process.env.SOURCE_TURSO_AUTH_TOKEN || undefined,
});

const dest = createClient({
  url: requireEnv("DEST_TURSO_DATABASE_URL"),
  authToken: process.env.DEST_TURSO_AUTH_TOKEN || undefined,
});

// Ordem sem relevância de FK (nenhuma tabela cgc_* tem FOREIGN KEY), mas
// mantida na ordem de criação de src/lib/db.ts por clareza.
const TABLES = [
  "cgc_groups",
  "cgc_activity_status",
  "cgc_history",
  "cgc_observations",
  "cgc_group_totals",
  "cgc_message_cache",
  "cgc_message_cache_sync",
];

async function migrateTable(table) {
  const { rows, columns } = await source.execute(`SELECT * FROM ${table}`);

  // cgc_groups e cgc_group_totals são caso especial: ensureDefaultGroups()
  // (chamada em toda leitura) já pode ter inserido os 4 grupos padrão no
  // destino com uuidv4() novos, diferentes dos ids de produção. INSERT OR
  // REPLACE só bate por PK `id`, então as linhas de origem (ids diferentes,
  // mesmos nomes) entrariam JUNTO das auto-criadas em vez de substituí-las —
  // 8 grupos em vez de 4, com cgc_group_totals órfã sobrando. Essas duas
  // tabelas são inteiramente donas da origem (diferente das outras, que são
  // seguras de mesclar), então limpamos o destino antes de inserir.
  if (!dryRun && (table === "cgc_groups" || table === "cgc_group_totals")) {
    await dest.execute(`DELETE FROM ${table}`);
  }

  if (rows.length === 0) {
    console.log(`${table}: 0 linhas na origem, nada a copiar.`);
    return { table, source: 0, dest: 0 };
  }

  if (!dryRun) {
    const placeholders = `(${columns.map(() => "?").join(", ")})`;
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`;
    for (const row of rows) {
      await dest.execute({ sql, args: columns.map((col) => row[col]) });
    }
  }

  const destCount = dryRun
    ? null
    : (await dest.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n;

  console.log(
    `${table}: ${rows.length} linhas na origem` +
      (dryRun ? " (dry-run, nada gravado)" : `, ${destCount} no destino após migração`)
  );
  return { table, source: rows.length, dest: destCount };
}

const results = [];
for (const table of TABLES) {
  results.push(await migrateTable(table));
}

if (!dryRun) {
  const mismatched = results.filter((r) => r.source !== r.dest);
  if (mismatched.length > 0) {
    console.error("Contagens não batem:", mismatched);
    process.exitCode = 1;
  } else {
    console.log("Todas as contagens batem entre origem e destino.");
  }
}
