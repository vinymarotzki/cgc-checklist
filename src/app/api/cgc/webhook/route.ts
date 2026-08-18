/**
 * Recebe o webhook configurado manualmente no painel do SASI (admin.sasi.io)
 * pro canal 33397 — a API pública (api.sasi.io) não documenta um endpoint pra
 * registrar essa URL, então o cadastro em si é feito fora do código, direto
 * no painel, apontando pra esta rota.
 *
 * O formato do payload que o SASI envia não é documentado, então esta rota
 * não tenta parseá-lo: usa a chamada só como sinal de "algo mudou, verifica
 * agora" e deixa syncAllGroups (mesma função usada pelo cron do GitHub
 * Actions) fazer o trabalho de verdade — busca as mensagens de cada grupo na
 * API SASI, mapeia, grava no cache e dispara notify pra atividade nova. Se no
 * futuro descobrirmos o formato real do payload, dá pra otimizar lendo o
 * message_id direto dele em vez de rescanear.
 *
 * Segredo separado do cron (CGC_WEBHOOK_SECRET, não CGC_CRON_SECRET): a URL
 * do webhook fica cadastrada num painel de terceiro fora do nosso controle,
 * então convém poder trocar essa credencial sem mexer no GitHub Actions.
 * Aceita o secret tanto no header quanto na query string porque não dá pra
 * saber de antemão se o painel do SASI permite configurar header customizado
 * — uma URL com `?secret=` sempre funciona, mesmo no campo mais simples
 * "URL de destino".
 *
 * Aceita GET além de POST: alguns provedores fazem uma checagem (handshake)
 * na própria URL antes de aceitar o cadastro do webhook, e essa checagem às
 * vezes é um GET simples.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncAllGroups } from "@/lib/cgc/message-cache";
import { resolveSasiToken } from "@/lib/sasi-api/client";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CGC_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  const header = req.headers.get("x-webhook-secret")?.trim();
  const query = req.nextUrl.searchParams.get("secret")?.trim();
  return header === secret || query === secret;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const token = resolveSasiToken(null);
  if (!token) {
    return NextResponse.json({ error: "SASI_API_TOKEN não configurado." }, { status: 500 });
  }

  const result = await syncAllGroups(token);
  return NextResponse.json({ received: true, ...result });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
