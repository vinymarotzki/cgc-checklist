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

  const completedAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO completed_checklists (id, user_id, user_name, total_items, completed_items, completed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
    args: [uuidv4(), String(user.id), String(user.name), total, done, completedAt],
  });

  await db.execute(`
    UPDATE activities
    SET status = 'SEM_STATUS', responsible = NULL, observation = NULL
  `);

  return NextResponse.json({ success: true, completedAt });
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
