import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/auth";
import { isOwner } from "@/lib/ownership";
import { NO_ACCESS_MESSAGE, readSasiTokenHeader } from "@/lib/token";
import type { InStatement } from "@libsql/client";
import { v4 as uuidv4 } from "uuid";

// O token só é aceito no header `x-sasi-token`; fora desse modelo, é usuário sem acesso.
async function requireAuth(req: NextRequest) {
  const token = readSasiTokenHeader(req.headers);

  if (!token) {
    return { user: null, error: NextResponse.json({ error: NO_ACCESS_MESSAGE }, { status: 401 }) };
  }

  const user = await authenticateToken(token);
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 }) };
  }

  return { user, error: null };
}

/**
 * Monta (sem executar) o INSERT de histórico da observação, para ir no mesmo
 * `db.batch` da escrita — antes eram chamadas separadas e uma falha entre
 * elas deixava a observação gravada sem o registro no histórico.
 */
function observationHistoryStatement(activityId: string, status: string, user: { id: unknown; name: unknown }, message: string): InStatement {
  return {
    sql: `INSERT INTO history (id, activity_id, old_status, new_status, user_id, user_name, observation, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      uuidv4(),
      activityId,
      status,
      status,
      String(user.id),
      String(user.name),
      message,
      new Date().toISOString(),
    ],
  };
}

async function getActivityStatus(db: ReturnType<typeof getDb>, activityId: string) {
  const result = await db.execute({
    sql: `SELECT status FROM activities WHERE id = ?`,
    args: [activityId],
  });
  return result.rows.length > 0 ? String(result.rows[0].status) : "SEM_STATUS";
}

const NOT_AUTHOR_MESSAGE = "Só quem escreveu a observação pode alterá-la ou apagá-la.";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const user = auth.user;

  await initDb();
  const db = getDb();

  // A tela do checklist só mostra as observações dele, mas a rota devolvia as
  // 1000 mais recentes de TODOS os checklists — com vários checklists
  // ativos, as do checklist aberto podiam ficar de fora do corte. Com
  // ?checklist= filtra no banco; sem o parâmetro mantém o comportamento
  // antigo, para quem ainda chama a rota sem escopo.
  const checklistId = req.nextUrl.searchParams.get("checklist")?.trim();
  const result = checklistId
    ? await db.execute({
        sql: `SELECT o.*
              FROM observations o
              JOIN activities a ON a.id = o.activity_id
              WHERE a.checklist_id = ?
              ORDER BY o.updated_at DESC
              LIMIT 1000`,
        args: [checklistId],
      })
    : await db.execute(`
        SELECT *
        FROM observations
        ORDER BY updated_at DESC
        LIMIT 1000
      `);

  return NextResponse.json({ observations: result.rows, user });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const user = auth.user;

  const body = await req.json();
  const { activity_id, text } = body;

  if (!activity_id || !text || typeof text !== "string") {
    return NextResponse.json({ error: "activity_id e text são obrigatórios" }, { status: 400 });
  }

  await initDb();
  const db = getDb();
  const now = new Date().toISOString();

  const observation = {
    id: uuidv4(),
    activity_id,
    text: text.trim(),
    user_id: String(user.id),
    user_name: String(user.name),
    created_at: now,
    updated_at: now,
  };

  const status = await getActivityStatus(db, observation.activity_id);
  await db.batch(
    [
      {
        sql: `INSERT INTO observations (id, activity_id, text, user_id, user_name, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          observation.id,
          observation.activity_id,
          observation.text,
          observation.user_id,
          observation.user_name,
          observation.created_at,
          observation.updated_at,
        ],
      },
      observationHistoryStatement(observation.activity_id, status, user, `Observação adicionada: ${observation.text}`),
    ],
    "write"
  );

  return NextResponse.json({ observation });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const user = auth.user;

  const body = await req.json();
  const { id, text } = body;

  if (!id || !text || typeof text !== "string") {
    return NextResponse.json({ error: "id e text são obrigatórios" }, { status: 400 });
  }

  await initDb();
  const db = getDb();
  const now = new Date().toISOString();

  const current = await db.execute({
    sql: `SELECT * FROM observations WHERE id = ?`,
    args: [id],
  });

  if (current.rows.length === 0) {
    return NextResponse.json({ error: "Observação não encontrada" }, { status: 404 });
  }

  const record = current.rows[0];
  if (!isOwner(record.user_id, user.id)) {
    return NextResponse.json({ error: NOT_AUTHOR_MESSAGE }, { status: 403 });
  }

  const activityId = String(record.activity_id);
  const status = await getActivityStatus(db, activityId);
  await db.batch(
    [
      {
        sql: `UPDATE observations SET text = ?, updated_at = ? WHERE id = ?`,
        args: [text.trim(), now, id],
      },
      observationHistoryStatement(activityId, status, user, `Observação editada: ${text.trim()}`),
    ],
    "write"
  );

  const updated = await db.execute({
    sql: `SELECT * FROM observations WHERE id = ?`,
    args: [id],
  });

  return NextResponse.json({ observation: updated.rows[0] });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const user = auth.user;

  const body = await req.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });
  }

  await initDb();
  const db = getDb();

  const current = await db.execute({
    sql: `SELECT * FROM observations WHERE id = ?`,
    args: [id],
  });

  if (current.rows.length === 0) {
    return NextResponse.json({ error: "Observação não encontrada" }, { status: 404 });
  }

  const observationRecord = current.rows[0];
  if (!isOwner(observationRecord.user_id, user.id)) {
    return NextResponse.json({ error: NOT_AUTHOR_MESSAGE }, { status: 403 });
  }

  const activityId = String(observationRecord.activity_id);
  const status = await getActivityStatus(db, activityId);
  await db.batch(
    [
      { sql: `DELETE FROM observations WHERE id = ?`, args: [id] },
      observationHistoryStatement(activityId, status, user, `Observação apagada: ${String(observationRecord.text)}`),
    ],
    "write"
  );

  return NextResponse.json({ success: true, id });
}
