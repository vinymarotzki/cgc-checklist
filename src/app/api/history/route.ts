import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/auth";
import { NO_ACCESS_MESSAGE, readSasiTokenHeader } from "@/lib/token";

export async function GET(req: NextRequest) {
  // O token só é aceito no header `x-sasi-token`; fora desse modelo, é usuário sem acesso.
  const token = readSasiTokenHeader(req.headers);

  if (!token) {
    return NextResponse.json({ error: NO_ACCESS_MESSAGE }, { status: 401 });
  }

  const user = await authenticateToken(token);
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
