/**
 * Resumo de atividades concluídas do CGC por grupo, para a página /controle.
 *
 * Proxy pro sasi-cgc: desde a separação em dois sistemas, os dados do CGC
 * não vivem mais neste banco. CGC_APP_URL é server-only, nunca exposta ao
 * navegador — o front-end de /controle continua chamando esta rota local,
 * sem saber que ela virou um repasse.
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

  try {
    const response = await fetch(`${cgcAppUrl}/api/controle/cgc`, {
      cache: "no-store",
      // Mesmo timeout de SASI_API_TIMEOUT_MS (client.ts do sasi-cgc): sem
      // isso, um sasi-cgc lento (ex: no meio de um scan contra a API SASI,
      // não necessariamente fora do ar) deixa a requisição pendurada em vez
      // de degradar pro erro 502 abaixo.
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
