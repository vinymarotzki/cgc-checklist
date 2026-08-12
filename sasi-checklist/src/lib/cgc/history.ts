/**
 * Histórico das Atividades do CGC.
 *
 * Mesmo papel da tabela `history` do checklist, mas separada: a atividade do
 * CGC vive na API SASI e não tem linha em `activities`, então cada entrada
 * carrega o retrato dos dados no momento da alteração.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, initDb } from "@/lib/db";

export interface CgcHistoryEntry {
  id: string;
  message_id: string;
  group_id: string | null;
  group_name: string | null;
  description: string | null;
  priority: string | null;
  deadline: string | null;
  old_status: string | null;
  new_status: string | null;
  observation: string | null;
  user_id: string | null;
  user_name: string | null;
  created_at: string;
}

/** Retrato da atividade enviado pela tela junto com a alteração. */
export interface CgcActivitySnapshot {
  group_id?: string | null;
  group_name?: string | null;
  description?: string | null;
  priority?: string | null;
  deadline?: string | null;
}

export interface RecordHistoryInput extends CgcActivitySnapshot {
  message_id: string;
  old_status?: string | null;
  new_status?: string | null;
  observation?: string | null;
  user: { id: string; name: string };
}

function nullable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Registra uma alteração. Nunca lança: histórico é registro secundário e não
 * pode impedir que a troca de status ou o comentário sejam salvos.
 */
export async function recordHistory(input: RecordHistoryInput): Promise<void> {
  try {
    await initDb();
    const db = getDb();

    await db.execute({
      sql: `INSERT INTO cgc_history
              (id, message_id, group_id, group_name, description, priority, deadline,
               old_status, new_status, observation, user_id, user_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        uuidv4(),
        input.message_id,
        nullable(input.group_id),
        nullable(input.group_name),
        nullable(input.description),
        nullable(input.priority),
        nullable(input.deadline),
        nullable(input.old_status),
        nullable(input.new_status),
        nullable(input.observation),
        input.user.id,
        input.user.name,
        new Date().toISOString(),
      ],
    });
  } catch {
    // Registro do histórico é secundário; a operação principal já foi feita.
  }
}

/** Lê o snapshot enviado no corpo da requisição, sem confiar no formato. */
export function readSnapshot(source: Record<string, unknown>): CgcActivitySnapshot {
  return {
    group_id: nullable(source.group_id),
    group_name: nullable(source.group_name),
    description: nullable(source.description),
    priority: nullable(source.priority),
    deadline: nullable(source.deadline),
  };
}

export async function listHistory(limit = 300): Promise<CgcHistoryEntry[]> {
  await initDb();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT * FROM cgc_history ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows as unknown as CgcHistoryEntry[];
}
