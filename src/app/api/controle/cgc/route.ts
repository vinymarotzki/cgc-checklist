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
