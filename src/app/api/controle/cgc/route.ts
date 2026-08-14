/**
 * Resumo de atividades concluídas do CGC por grupo, para a página /controle.
 *
 * Rota pública de propósito (ver /api/controle/checklists). Números vêm do
 * acompanhamento local (cgc_activity_status), igual ao card de cada grupo em
 * /atividades-cgc — não escaneia a API SASI.
 */

import { NextResponse } from "next/server";
import { listGroups } from "@/lib/cgc/groups";
import { getConcludedCountByGroup } from "@/lib/cgc/status-store";

export async function GET() {
  try {
    const [groups, concluded] = await Promise.all([
      listGroups(),
      getConcludedCountByGroup(),
    ]);

    return NextResponse.json({
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        concluded: concluded[group.id] ?? 0,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Falha ao carregar o resumo do CGC." }, { status: 500 });
  }
}
