import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/auth";
import { NO_ACCESS_MESSAGE, readSasiToken } from "@/lib/token";
import { v4 as uuidv4 } from "uuid";

// O token só é aceito em `sasi-token`; fora desse modelo, é usuário sem acesso.
async function requireAuth(req: NextRequest) {
  const token = readSasiToken(req.nextUrl.searchParams);

  if (!token) {
    return { user: null, error: NextResponse.json({ error: NO_ACCESS_MESSAGE }, { status: 401 }) };
  }

  const user = await authenticateToken(token);
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 }) };
  }

  return { user, error: null };
}

async function logObservationHistory(db: ReturnType<typeof getDb>, activityId: string, status: string, user: { id: string; name: string }, message: string) {
  await db.execute({
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
  });
}

async function getActivityStatus(db: ReturnType<typeof getDb>, activityId: string) {
  const result = await db.execute({
    sql: `SELECT status FROM activities WHERE id = ?`,
    args: [activityId],
  });
  return result.rows.length > 0 ? String(result.rows[0].status) : "SEM_STATUS";
}

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

  await db.execute({
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
  });

  await logObservationHistory(db, observation.activity_id, await getActivityStatus(db, observation.activity_id), user, `Observação adicionada: ${observation.text}`);

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

  await db.execute({
    sql: `UPDATE observations SET text = ?, updated_at = ? WHERE id = ?`,
    args: [text.trim(), now, id],
  });

  const updated = await db.execute({
    sql: `SELECT * FROM observations WHERE id = ?`,
    args: [id],
  });

  await logObservationHistory(db, String(updated.rows[0].activity_id), await getActivityStatus(db, String(updated.rows[0].activity_id)), user, `Observação editada: ${text.trim()}`);

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

  await db.execute({
    sql: `DELETE FROM observations WHERE id = ?`,
    args: [id],
  });

  await logObservationHistory(db, String(observationRecord.activity_id), await getActivityStatus(db, String(observationRecord.activity_id)), user, `Observação apagada: ${String(observationRecord.text)}`);

  return NextResponse.json({ success: true, id });
}
