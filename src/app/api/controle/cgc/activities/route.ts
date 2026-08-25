/**
 * Atividades concluídas de um grupo do CGC, para exportar XLSX em /controle.
 *
 * Proxy pro sasi-cgc — ver src/app/api/controle/cgc/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const cgcAppUrl = process.env.CGC_APP_URL;
  if (!cgcAppUrl) {
    return NextResponse.json(
      { error: "CGC_APP_URL não configurada no servidor." },
      { status: 500 }
    );
  }

  const groupId = req.nextUrl.searchParams.get("group")?.trim();
  if (!groupId) {
    return NextResponse.json({ error: "Selecione um grupo." }, { status: 400 });
  }

  try {
    const url = new URL("/api/controle/cgc/activities", cgcAppUrl);
    url.searchParams.set("group", groupId);
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Falha ao consultar o sistema do CGC." },
      { status: 502 }
    );
  }
}
