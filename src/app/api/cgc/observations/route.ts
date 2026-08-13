/**
 * Comentários das Atividades do CGC.
 *
 * Mesma interação das observações do checklist, mas em tabela própria
 * (`cgc_observations`, chaveada pelo id da mensagem na API SASI). A rota
 * `/api/observations` registra tudo em `history`, e `/history` faz LEFT JOIN
 * com `activities` — reutilizá-la encheria a tela de histórico do checklist de
 * linhas sem atividade correspondente.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "@/lib/api-auth";
import { getDb, initDb } from "@/lib/db";
import { readSnapshot, recordHistory } from "@/lib/cgc/history";
import { getStatus } from "@/lib/cgc/status-store";

const MAX_OBSERVATIONS = 1000;

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

/**
 * Registra o comentário no histórico do CGC usando o mesmo prefixo do
 * checklist ("Observação adicionada/editada/apagada:"), para que a tela de
 * histórico reconheça o evento e o exiba do mesmo jeito.
 */
async function recordCommentHistory(
  messageId: string,
  observation: string,
  body: Record<string, unknown>,
  user: { id: unknown; name: unknown }
) {
  const status = await getStatus(messageId).catch(() => null);
  await recordHistory({
    ...readSnapshot(body),
    message_id: messageId,
    old_status: status,
    new_status: status,
    observation,
    user: { id: String(user.id), name: String(user.name) },
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    await initDb();
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT * FROM cgc_observations ORDER BY created_at ASC LIMIT ?`,
      args: [MAX_OBSERVATIONS],
    });
    return NextResponse.json({ observations: result.rows, user: auth.user });
  } catch {
    return NextResponse.json({ error: "Falha ao carregar os comentários." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await readBody(req);
  const messageId = readString(body, "message_id");
  const text = readString(body, "text");

  if (!messageId || !text) {
    return NextResponse.json({ error: "message_id e text são obrigatórios" }, { status: 400 });
  }

  try {
    await initDb();
    const db = getDb();
    const now = new Date().toISOString();
    const observation = {
      id: uuidv4(),
      message_id: messageId,
      text,
      user_id: String(auth.user.id),
      user_name: String(auth.user.name),
      created_at: now,
      updated_at: now,
    };

    await db.execute({
      sql: `INSERT INTO cgc_observations
              (id, message_id, text, user_id, user_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        observation.id,
        observation.message_id,
        observation.text,
        observation.user_id,
        observation.user_name,
        observation.created_at,
        observation.updated_at,
      ],
    });

    await recordCommentHistory(messageId, `Observação adicionada: ${text}`, body, auth.user);

    return NextResponse.json({ observation });
  } catch {
    return NextResponse.json({ error: "Falha ao salvar o comentário." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await readBody(req);
  const id = readString(body, "id");
  const text = readString(body, "text");

  if (!id || !text) {
    return NextResponse.json({ error: "id e text são obrigatórios" }, { status: 400 });
  }

  try {
    await initDb();
    const db = getDb();

    await db.execute({
      sql: `UPDATE cgc_observations SET text = ?, updated_at = ? WHERE id = ?`,
      args: [text, new Date().toISOString(), id],
    });

    const updated = await db.execute({
      sql: `SELECT * FROM cgc_observations WHERE id = ?`,
      args: [id],
    });

    if (updated.rows.length === 0) {
      return NextResponse.json({ error: "Comentário não encontrado" }, { status: 404 });
    }

    const messageId = String((updated.rows[0] as unknown as Record<string, unknown>).message_id);
    await recordCommentHistory(messageId, `Observação editada: ${text}`, body, auth.user);

    return NextResponse.json({ observation: updated.rows[0] });
  } catch {
    return NextResponse.json({ error: "Falha ao atualizar o comentário." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await readBody(req);
  const id = readString(body, "id");
  if (!id) {
    return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });
  }

  try {
    await initDb();
    const db = getDb();

    const current = await db.execute({
      sql: `SELECT message_id, text FROM cgc_observations WHERE id = ?`,
      args: [id],
    });

    await db.execute({ sql: `DELETE FROM cgc_observations WHERE id = ?`, args: [id] });

    const record = current.rows[0] as unknown as Record<string, unknown> | undefined;
    if (record) {
      await recordCommentHistory(
        String(record.message_id),
        `Observação apagada: ${String(record.text)}`,
        body,
        auth.user
      );
    }

    return NextResponse.json({ success: true, id });
  } catch {
    return NextResponse.json({ error: "Falha ao apagar o comentário." }, { status: 500 });
  }
}
