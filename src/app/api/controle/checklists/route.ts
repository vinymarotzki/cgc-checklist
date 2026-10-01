/**
 * Resumo de checklists finalizados, para a página /controle.
 *
 * Exige sasi-token como as demais rotas. Era pública "por obscuridade" (só
 * quem sabia a URL), mas a URL é fácil de adivinhar e a resposta expõe
 * nomes de usuários, responsáveis e observações de todos os checklists.
 * Mesmas queries de /api/history, só que sem a parte de log por atividade.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getDb, initDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

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
