/**
 * Histórico das Atividades do CGC.
 * Só leitura — as entradas são gravadas pelas rotas de status e de comentários.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listHistory } from "@/lib/cgc/history";
import { listGroups } from "@/lib/cgc/groups";
import { getConcludedCountByGroup } from "@/lib/cgc/status-store";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const [history, groups, concluded] = await Promise.all([
      listHistory(),
      listGroups(),
      getConcludedCountByGroup(),
    ]);

    return NextResponse.json({
      history,
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        concluded: concluded[group.id] ?? 0,
      })),
      user: auth.user,
    });
  } catch {
    return NextResponse.json({ error: "Falha ao carregar o histórico." }, { status: 500 });
  }
}
