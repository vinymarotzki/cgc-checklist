import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { isOwner } from "@/lib/ownership";
import { invalidBodyResponse, readJsonBody, requireAuth } from "@/lib/api-auth";
import type { InStatement } from "@libsql/client";
import { v4 as uuidv4 } from "uuid";

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

  const result = await db.execute(`
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

  const body = await readJsonBody(req);
  if (!body) return invalidBodyResponse();
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

  const body = await readJsonBody(req);
  if (!body) return invalidBodyResponse();
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

  const body = await readJsonBody(req);
  if (!body) return invalidBodyResponse();
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
