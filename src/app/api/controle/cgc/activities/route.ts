/**
 * Atividades concluídas de um grupo do CGC, para exportar XLSX em /controle.
 *
 * Proxy pro cgc-atividades — ver src/app/api/controle/cgc/route.ts,
 * inclusive o header x-controle-secret (CONTROLE_PROXY_SECRET) que
 * autentica a chamada, e o motivo de exigir sasi-token antes do repasse.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const cgcAppUrl = process.env.CGC_APP_URL;
  if (!cgcAppUrl) {
    return NextResponse.json(
      { error: "CGC_APP_URL não configurada no servidor." },
      { status: 500 }
    );
  }

  const controleProxySecret = process.env.CONTROLE_PROXY_SECRET;
  if (!controleProxySecret) {
    return NextResponse.json(
      { error: "CONTROLE_PROXY_SECRET não configurada no servidor." },
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
    // Mesmo timeout de SASI_API_TIMEOUT_MS (client.ts do cgc-atividades):
    // sem isso, um cgc-atividades lento (ex: no meio de um scan contra a
    // API SASI, não necessariamente fora do ar) deixa a requisição
    // pendurada em vez de degradar pro erro 502 abaixo.
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "x-controle-secret": controleProxySecret },
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Falha ao consultar o sistema do CGC." },
      { status: 502 }
    );
  }
}
