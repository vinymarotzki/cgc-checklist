import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/sasi";
import { v4 as uuidv4 } from "uuid";

function isLocalRequest(host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("sasi-token") || req.nextUrl.searchParams.get("token");
  const host = req.headers.get("host") || req.nextUrl.host;
  const local = isLocalRequest(host);

  if (!token && !local) {
    return NextResponse.json({ error: "Token obrigatório" }, { status: 401 });
  }

  const user = token ? await authenticateToken(token) : local ? { id: "local", name: "Local" } : null;
  if (!user) {
    return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 });
  }

  try {
    await initDb();
    const db = getDb();

    const stats = await db.execute(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'CONCLUIDO' THEN 1 ELSE 0 END) AS done
      FROM activities
    `);

    const row = stats.rows[0] as unknown as { total: number; done: number };
    const total = Number(row.total || 0);
    const done = Number(row.done || 0);

    if (total === 0) {
      return NextResponse.json({ error: "Não há atividades cadastradas." }, { status: 400 });
    }

    if (done < total) {
      return NextResponse.json({ error: "Checklist ainda não está 100% concluído." }, { status: 400 });
    }

    const activitiesResult = await db.execute(`
      SELECT *
      FROM activities
      ORDER BY category, rowid
    `);

    const activities = activitiesResult.rows as unknown as Array<{
      id: string;
      category: string;
      activity: string;
      status: string;
      responsible: string | null;
      observation: string | null;
    }>;

    const completedAt = new Date().toISOString();
    const checklistId = uuidv4();

    await db.execute({
      sql: `INSERT INTO completed_checklists (id, user_id, user_name, total_items, completed_items, created_at, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [checklistId, String(user.id), String(user.name), total, done, completedAt, completedAt],
    });

  for (const activity of activities) {
    const lastUpdateResult = await db.execute({
      sql: `SELECT MAX(created_at) AS last_updated_at
            FROM history
            WHERE activity_id = ?`,
      args: [activity.id],
    });

    const lastObservationResult = await db.execute({
      sql: `SELECT text FROM observations
            WHERE activity_id = ?
            ORDER BY updated_at DESC
            LIMIT 1`,
      args: [activity.id],
    });

    const lastUpdatedRow = lastUpdateResult.rows[0] as unknown as { last_updated_at: string | null };
    const lastUpdatedAt = lastUpdatedRow?.last_updated_at || completedAt;
    const observation = lastObservationResult.rows.length > 0
      ? String(lastObservationResult.rows[0].text)
      : activity.observation ?? null;

    await db.execute({
      sql: `INSERT INTO completed_checklist_items (id, checklist_id, activity_id, description, category, status, responsible, observation, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        uuidv4(),
        checklistId,
        activity.id,
        activity.activity,
        activity.category,
        activity.status,
        activity.responsible ?? null,
        observation,
        lastUpdatedAt,
      ],
    });
  }

  await db.execute(`
    UPDATE activities
    SET status = 'SEM_STATUS', responsible = NULL, observation = NULL
  `);

  await db.execute(`
    DELETE FROM history
  `);

  return NextResponse.json({ success: true, completedAt });
  } catch (error) {
    console.error("POST /api/checklists failed:", error);
    return NextResponse.json({ error: "Erro interno ao finalizar checklist." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("sasi-token") || req.nextUrl.searchParams.get("token");
  const host = req.headers.get("host") || req.nextUrl.host;
  const local = isLocalRequest(host);

  if (!token && !local) {
    return NextResponse.json({ error: "Token obrigatório" }, { status: 401 });
  }

  const user = token ? await authenticateToken(token) : local ? { id: "local", name: "Local" } : null;
  if (!user) {
    return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 });
  }

  await initDb();
  const db = getDb();

  const result = await db.execute(`
    SELECT *
    FROM completed_checklists
    ORDER BY completed_at DESC
    LIMIT 200
  `);

  return NextResponse.json({ completed: result.rows, user });
}
