/**
 * Acompanhamento do status das Atividades do CGC.
 *
 * O token de provider da API SASI só tem escopo READ_MESSAGES — não há como
 * gravar status de volta lá. O status é então mantido aqui, na tabela
 * `cgc_activity_status`, com o mesmo vocabulário e o mesmo default do checklist.
 */

import { getDb, initDb } from "@/lib/db";
import { STATUS_OPTIONS } from "@/lib/checklist-status";

/** Status inicial de toda atividade ainda não tratada. */
export const CGC_DEFAULT_STATUS = "NAO_INICIADO";

/** Status que o usuário pode escolher — os mesmos do seletor do checklist. */
export const CGC_ALLOWED_STATUSES = STATUS_OPTIONS.map((option) => option.value);

export function isAllowedStatus(value: unknown): value is string {
  return typeof value === "string" && CGC_ALLOWED_STATUSES.includes(value);
}

/** Status registrados para as mensagens informadas, por id. */
export async function getStatuses(messageIds: string[]): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (ids.length === 0) return statuses;

  await initDb();
  const db = getDb();

  // Consultado em lotes para não estourar o limite de variáveis do SQLite.
  const BATCH_SIZE = 200;
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db.execute({
      sql: `SELECT message_id, status FROM cgc_activity_status WHERE message_id IN (${placeholders})`,
      args: batch,
    });

    for (const row of result.rows) {
      const record = row as unknown as Record<string, unknown>;
      statuses.set(String(record.message_id), String(record.status));
    }
  }

  return statuses;
}

/** Status atual de uma atividade, ou o default quando nunca foi alterada. */
export async function getStatus(messageId: string): Promise<string> {
  await initDb();
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT status FROM cgc_activity_status WHERE message_id = ?",
    args: [messageId],
  });
  const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
  return row ? String(row.status) : CGC_DEFAULT_STATUS;
}

export async function setStatus(
  messageId: string,
  status: string,
  user: { id: string; name: string },
  groupId?: string | null
): Promise<void> {
  await initDb();
  const db = getDb();

  await db.execute({
    sql: `INSERT INTO cgc_activity_status (message_id, status, group_id, user_id, user_name, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(message_id) DO UPDATE SET
            status = excluded.status,
            group_id = COALESCE(excluded.group_id, cgc_activity_status.group_id),
            user_id = excluded.user_id,
            user_name = excluded.user_name,
            updated_at = excluded.updated_at`,
    args: [messageId, status, groupId ?? null, user.id, user.name, new Date().toISOString()],
  });
}

/**
 * Marca de qual grupo são as atividades listadas.
 *
 * Só preenche o que ainda está vazio — linhas gravadas antes de a coluna
 * existir passam a contar para o grupo certo na primeira vez que aparecem.
 */
export async function backfillGroup(messageIds: string[], groupId: string): Promise<void> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (ids.length === 0) return;

  try {
    await initDb();
    const db = getDb();
    const placeholders = ids.map(() => "?").join(", ");
    await db.execute({
      sql: `UPDATE cgc_activity_status SET group_id = ?
            WHERE group_id IS NULL AND message_id IN (${placeholders})`,
      args: [groupId, ...ids],
    });
  } catch {
    // Marcação é acessória; a listagem não pode falhar por causa dela.
  }
}

/**
 * Total de atividades acompanhadas e quantas estão concluídas, por grupo —
 * para os cards da tela de seleção mostrarem o andamento de cada um.
 *
 * "Total" é o que já passou por `backfillGroup` (toda atividade que a
 * listagem do grupo já carregou pelo menos uma vez), não o total real na API
 * SASI: contar isso ao vivo exigiria varrer o provider para cada grupo só
 * para montar esta tela, o que a arquitetura evita (ver `SASI_CGC_SCAN_CAP`
 * em `/api/cgc/activities`).
 */
export async function getGroupCounts(): Promise<Record<string, { total: number; concluded: number }>> {
  await initDb();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT group_id, COUNT(*) AS total,
                 SUM(CASE WHEN status = 'CONCLUIDO' THEN 1 ELSE 0 END) AS concluded
          FROM cgc_activity_status
          WHERE group_id IS NOT NULL
          GROUP BY group_id`,
    args: [],
  });

  const counts: Record<string, { total: number; concluded: number }> = {};
  for (const row of result.rows) {
    const record = row as unknown as Record<string, unknown>;
    counts[String(record.group_id)] = {
      total: Number(record.total || 0),
      concluded: Number(record.concluded || 0),
    };
  }
  return counts;
}

/** Quantidade de atividades concluídas por grupo, para os cards da tela inicial. */
export async function getConcludedCountByGroup(): Promise<Record<string, number>> {
  await initDb();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT group_id, COUNT(*) AS total
          FROM cgc_activity_status
          WHERE status = ? AND group_id IS NOT NULL
          GROUP BY group_id`,
    args: ["CONCLUIDO"],
  });

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    const record = row as unknown as Record<string, unknown>;
    counts[String(record.group_id)] = Number(record.total || 0);
  }
  return counts;
}
