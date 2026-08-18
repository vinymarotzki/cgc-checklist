/**
 * Sincronização em background dos grupos do CGC — sem isso, syncGroupMessages
 * (e o notify que dispara a partir dela) só rodava como efeito colateral de
 * alguém ter a página do grupo aberta no navegador (poll do client a cada
 * REFRESH_INTERVAL_MS). Sem ninguém olhando, atividade nova só era detectada
 * (e o push só disparava) na próxima vez que alguém abrisse aquele grupo
 * específico — podia demorar horas ou nunca acontecer.
 *
 * Chamada por um cron externo (GitHub Actions, já que o plano Hobby do Vercel
 * limita cron a 1x/dia — longe de tempo real). Protegida por CGC_CRON_SECRET
 * porque, sem token de usuário, não há AUTH_USER_ENDPOINT pra validar quem
 * chama; sem o secret certo, todo mundo recebe 401.
 */

import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { listGroups } from "@/lib/cgc/groups";
import { syncGroupMessages } from "@/lib/cgc/message-cache";
import { resolveSasiToken } from "@/lib/sasi-api/client";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CGC_CRON_SECRET?.trim();
  if (!secret) return false;

  const header = req.headers.get("x-cron-secret")?.trim();
  return header === secret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const token = resolveSasiToken(null);
  if (!token) {
    return NextResponse.json({ error: "SASI_API_TOKEN não configurado." }, { status: 500 });
  }

  await initDb();
  const groups = await listGroups();

  const results = await Promise.allSettled(
    groups.map((group) => syncGroupMessages(group, token))
  );

  const failed = results
    .map((result, index) => ({ result, group: groups[index] }))
    .filter(({ result }) => result.status === "rejected");

  for (const { result, group } of failed) {
    const reason = result as PromiseRejectedResult;
    console.error(`[cgc-cron-sync] falha ao sincronizar grupo "${group.name}": ${reason.reason}`);
  }

  return NextResponse.json({
    synced: groups.length - failed.length,
    total: groups.length,
    failed: failed.map(({ group }) => group.name),
  });
}
