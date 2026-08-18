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
 * Último retrato gravado para a mensagem.
 *
 * A descrição vem do campo `descreva` do formulário e só chega até aqui pelo
 * snapshot que a tela envia. Quando uma chamada não o envia, reaproveitar o
 * último conhecido evita gravar uma linha que a tela de histórico só saberia
 * identificar pelo id da mensagem.
 */
async function getLatestSnapshot(messageId: string): Promise<CgcActivitySnapshot | null> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT group_id, group_name, description, deadline
            FROM cgc_history
           WHERE message_id = ? AND description IS NOT NULL
           ORDER BY created_at DESC
           LIMIT 1`,
    args: [messageId],
  });

  const row = result.rows[0] as unknown as CgcActivitySnapshot | undefined;
  return row ?? null;
}

/**
 * Registra uma alteração. Nunca lança: histórico é registro secundário e não
 * pode impedir que a troca de status ou o comentário sejam salvos.
 */
export async function recordHistory(input: RecordHistoryInput): Promise<void> {
  try {
    await initDb();
    const db = getDb();

    const previous = nullable(input.description)
      ? null
      : await getLatestSnapshot(input.message_id).catch(() => null);
    const snapshot: CgcActivitySnapshot = {
      group_id: nullable(input.group_id) ?? nullable(previous?.group_id),
      group_name: nullable(input.group_name) ?? nullable(previous?.group_name),
      description: nullable(input.description) ?? nullable(previous?.description),
      deadline: nullable(input.deadline) ?? nullable(previous?.deadline),
    };

    await db.execute({
      sql: `INSERT INTO cgc_history
              (id, message_id, group_id, group_name, description, deadline,
               old_status, new_status, observation, user_id, user_name, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        uuidv4(),
        input.message_id,
        snapshot.group_id ?? null,
        snapshot.group_name ?? null,
        snapshot.description ?? null,
        snapshot.deadline ?? null,
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
