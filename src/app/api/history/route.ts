import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/sasi";

function isLocalRequest(host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
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
    SELECT h.*, a.activity, a.category
    FROM history h
    LEFT JOIN activities a ON h.activity_id = a.id
    ORDER BY h.created_at DESC
    LIMIT 200
  `);

  const completedResult = await db.execute(`
    SELECT *
    FROM completed_checklists
    ORDER BY completed_at DESC
    LIMIT 100
  `);

  const selectedChecklistId = req.nextUrl.searchParams.get("checklist_id");
  console.log("/api/history called with checklist_id:", selectedChecklistId);

  let selectedChecklistItems: unknown[] = [];

  if (selectedChecklistId) {
    const itemsResult = await db.execute({
      sql: `
        SELECT id, checklist_id, activity_id, description, category, status, responsible, observation, updated_at
        FROM completed_checklist_items
        WHERE checklist_id = ?
        ORDER BY category, rowid
      `,
      args: [selectedChecklistId],
    });
    console.log("completed_checklist_items rows count:", itemsResult.rows.length);
    selectedChecklistItems = itemsResult.rows;
  }

  return NextResponse.json({
    history: result.rows,
    completed: completedResult.rows,
    selectedChecklistItems,
    user,
  });
}
