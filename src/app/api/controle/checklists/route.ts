/**
 * Resumo de checklists finalizados, para a página /controle.
 *
 * Rota pública de propósito: /controle não exige sasi-token (ver CLAUDE.md).
 * Mesmas queries de /api/history, só que sem a parte de log por atividade.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  await initDb();
  const db = getDb();

  const completedResult = await db.execute(`
    SELECT *
    FROM completed_checklists
    ORDER BY completed_at DESC
    LIMIT 100
  `);

  const checklistId = req.nextUrl.searchParams.get("checklist_id");
  let items: unknown[] = [];

  if (checklistId) {
    const itemsResult = await db.execute({
      sql: `
        SELECT id, checklist_id, activity_id, description, category, status, responsible, observation, updated_at
        FROM completed_checklist_items
        WHERE checklist_id = ?
        ORDER BY category, rowid
      `,
      args: [checklistId],
    });
    items = itemsResult.rows;
  }

  return NextResponse.json({
    completed: completedResult.rows,
    items,
  });
}
