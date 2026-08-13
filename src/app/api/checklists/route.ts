import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

function isLocalRequest(host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

async function requireAuth(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("sasi-token") || req.nextUrl.searchParams.get("token");
  const host = req.headers.get("host") || req.nextUrl.host;
  const local = isLocalRequest(host);

  if (!token && !local) {
    return { user: null, error: NextResponse.json({ error: "Token obrigatorio" }, { status: 401 }) };
  }

  const user = token ? await authenticateToken(token) : local ? { id: "local", name: "Local" } : null;
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Token invalido ou expirado" }, { status: 401 }) };
  }

  return { user, error: null };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  await initDb();
  const db = getDb();

  const result = await db.execute(`
    SELECT
      c.id,
      c.title,
      c.created_by_id,
      c.created_by_name,
      c.created_at,
      COUNT(a.id) AS activity_count,
      SUM(CASE WHEN a.status = 'CONCLUIDO' THEN 1 ELSE 0 END) AS completed_count
    FROM checklists c
    LEFT JOIN activities a ON a.checklist_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `);

  const checklists = result.rows.map((row) => {
    const activityCount = Number(row.activity_count || 0);
    const completedCount = Number(row.completed_count || 0);
    return {
      ...row,
      activity_count: activityCount,
      completed_count: completedCount,
      progress: activityCount > 0 ? Math.round((completedCount / activityCount) * 100) : 0,
    };
  });

  return NextResponse.json({ checklists, user: auth.user });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const activities = Array.isArray(body.activities) ? body.activities : [];

  if (!title) {
    return NextResponse.json({ error: "Titulo obrigatorio" }, { status: 400 });
  }

  await initDb();
  const db = getDb();
  const now = new Date().toISOString();
  const checklistId = uuidv4();

  await db.execute({
    sql: `INSERT INTO checklists (id, title, created_by_id, created_by_name, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [checklistId, title, String(auth.user.id), String(auth.user.name), now],
  });

  for (const item of activities) {
    const category = typeof item?.category === "string" ? item.category.trim() : "";
    const activity = typeof item?.activity === "string" ? item.activity.trim() : "";
    if (!category || !activity) continue;

    await db.execute({
      sql: `INSERT INTO activities (id, category, activity, status, responsible, observation, checklist_id)
            VALUES (?, ?, ?, 'SEM_STATUS', NULL, NULL, ?)`,
      args: [uuidv4(), category, activity, checklistId],
    });
  }

  return NextResponse.json({
    success: true,
    checklist: {
      id: checklistId,
      title,
      created_by_id: String(auth.user.id),
      created_by_name: String(auth.user.name),
      created_at: now,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!id) {
    return NextResponse.json({ error: "ID do checklist obrigatorio" }, { status: 400 });
  }

  if (!title) {
    return NextResponse.json({ error: "Titulo obrigatorio" }, { status: 400 });
  }

  await initDb();
  const db = getDb();

  await db.execute({
    sql: "UPDATE checklists SET title = ? WHERE id = ?",
    args: [title, id],
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id.trim() : "";

  if (!id) {
    return NextResponse.json({ error: "ID do checklist obrigatorio" }, { status: 400 });
  }

  await initDb();
  const db = getDb();

  await db.execute({
    sql: `DELETE FROM observations
          WHERE activity_id IN (SELECT id FROM activities WHERE checklist_id = ?)`,
    args: [id],
  });
  await db.execute({
    sql: `DELETE FROM history
          WHERE activity_id IN (SELECT id FROM activities WHERE checklist_id = ?)`,
    args: [id],
  });
  await db.execute({ sql: "DELETE FROM activities WHERE checklist_id = ?", args: [id] });
  await db.execute({ sql: "DELETE FROM checklists WHERE id = ?", args: [id] });

  return NextResponse.json({ success: true });
}
