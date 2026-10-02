import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const user = auth.user;

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
    selectedChecklistItems = itemsResult.rows;
  }

  return NextResponse.json({
    history: result.rows,
    completed: completedResult.rows,
    selectedChecklistItems,
    user,
  });
}
