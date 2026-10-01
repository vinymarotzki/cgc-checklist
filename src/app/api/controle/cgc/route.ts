/**
 * Resumo de atividades concluídas do CGC por grupo, para a página /controle.
 *
 * Proxy pro cgc-atividades: desde a separação em dois sistemas, os dados do
 * CGC não vivem mais neste banco. CGC_APP_URL é server-only, nunca exposta
 * ao navegador — o front-end de /controle continua chamando esta rota
 * local, sem saber que ela virou um repasse.
 *
 * A rota real no cgc-atividades virou alcançável pela rede (antes era o
 * mesmo processo), então autentica com CONTROLE_PROXY_SECRET no header
 * x-controle-secret — sem ele o cgc-atividades responde 401.
 */

import { NextResponse } from "next/server";

export async function GET() {
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

  try {
    const response = await fetch(`${cgcAppUrl}/api/controle/cgc`, {
      cache: "no-store",
      headers: { "x-controle-secret": controleProxySecret },
      // Mesmo timeout de SASI_API_TIMEOUT_MS (client.ts do cgc-atividades):
      // sem isso, um cgc-atividades lento (ex: no meio de um scan contra a
      // API SASI, não necessariamente fora do ar) deixa a requisição
      // pendurada em vez de degradar pro erro 502 abaixo.
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
