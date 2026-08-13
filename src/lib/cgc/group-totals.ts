/**
 * Total "solicitado" por grupo, sincronizado da API SASI e persistido em
 * `cgc_group_totals` — para os cards da tela de seleção mostrarem o volume
 * real, não só o que já foi visto ao abrir a listagem (ver `getGroupCounts`
 * em `status-store.ts` para o "concluído", que é local por natureza: o token
 * de provider não escreve status de volta).
 *
 * Sincronização incremental: cada grupo guarda `last_message_id`, o maior id
 * já contado. Um grupo já sincronizado não escaneia o canal de novo — só
 * busca páginas até encontrar uma sem mensagem mais nova que essa marca
 * d'água, e soma só o que é novo ao total salvo. Isso assume que
 * `GET /provider/messages` devolve mais recente primeiro (confirmado nos
 * dados reais do canal 33397); se algum dia deixar de ser verdade, o pior
 * caso é parar de contar cedo demais numa sincronização, não contar errado.
 *
 * Limite conhecido: mensagem apagada na API não é detectada aqui — o total
 * só cresce por sincronização incremental, nunca encolhe. Reconciliação
 * completa periódica poderia cobrir isso, mas não existe ainda.
 *
 * Além do incremental, cada grupo só sincroniza de novo depois de
 * `TOTALS_CACHE_TTL_MS`: dentro da janela, nem o endpoint de contagem é
 * chamado — o total salvo é devolvido direto do banco.
 */

import { getDb, initDb } from "@/lib/db";
import { SasiApiError, resolveSasiToken } from "@/lib/sasi-api/client";
import {
  SASI_MESSAGES_MAX_LIMIT,
  fetchProviderMessages,
  fetchProviderMessagesCount,
} from "@/lib/sasi-api/messages";
import type { SasiMessagesQuery, SasiProviderMessage } from "@/lib/sasi-api/types";
import { messageMatchesFieldRule } from "./mapper";
import { groupIsUnconfigured, groupToFieldRule, groupToMessagesQuery } from "./groups";
import type { CgcGroup } from "./types";

const TOTALS_CACHE_TTL_MS = 2 * 60 * 1000;

const SCAN_CAP = Number(process.env.SASI_CGC_SCAN_CAP) > 0
  ? Number(process.env.SASI_CGC_SCAN_CAP)
  : 500;

interface StoredGroupTotal {
  total: number;
  lastMessageId: number | null;
  updatedAt: string;
}

function queryKey(query: SasiMessagesQuery): string {
  return JSON.stringify([query.category_ids, query.team_name, query.channel_ids, query.app_ids]);
}

async function getStoredTotals(groupIds: string[]): Promise<Record<string, StoredGroupTotal>> {
  if (groupIds.length === 0) return {};
  await initDb();
  const db = getDb();
  const placeholders = groupIds.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `SELECT group_id, total, last_message_id, updated_at FROM cgc_group_totals WHERE group_id IN (${placeholders})`,
    args: groupIds,
  });

  const out: Record<string, StoredGroupTotal> = {};
  for (const row of result.rows) {
    const record = row as unknown as Record<string, unknown>;
    const lastMessageId = record.last_message_id;
    out[String(record.group_id)] = {
      total: Number(record.total || 0),
      lastMessageId: lastMessageId === null || lastMessageId === undefined ? null : Number(lastMessageId),
      updatedAt: String(record.updated_at),
    };
  }
  return out;
}

async function saveGroupTotal(groupId: string, total: number, lastMessageId: number | null): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO cgc_group_totals (group_id, total, last_message_id, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(group_id) DO UPDATE SET
            total = excluded.total,
            last_message_id = excluded.last_message_id,
            updated_at = excluded.updated_at`,
    args: [groupId, total, lastMessageId, new Date().toISOString()],
  });
}

function isStale(row: StoredGroupTotal | undefined): boolean {
  if (!row) return true;
  return Date.now() - new Date(row.updatedAt).getTime() >= TOTALS_CACHE_TTL_MS;
}

/**
 * Busca só as mensagens mais novas que `sinceId`. Para nas primeiras páginas
 * já vistas (ver nota de ordenação no topo do arquivo) — uma sincronização já
 * em dia normalmente resolve em zero ou uma chamada, não nas ~5 de uma
 * varredura completa.
 */
async function scanClusterSince(
  query: SasiMessagesQuery,
  token: string,
  sinceId: number
): Promise<{ messages: SasiProviderMessage[]; maxId: number }> {
  const messages: SasiProviderMessage[] = [];
  let maxId = sinceId;
  let scanned = 0;
  let page = 1;

  while (scanned < SCAN_CAP) {
    const batch = await fetchProviderMessages({ ...query, page, limit: SASI_MESSAGES_MAX_LIMIT }, { token });
    if (batch.length === 0) break;
    scanned += batch.length;

    let sawNew = false;
    for (const message of batch) {
      const id = typeof message.id === "number" ? message.id : null;
      if (id !== null && id > sinceId) {
        messages.push(message);
        sawNew = true;
        if (id > maxId) maxId = id;
      }
    }

    // Página sem nada novo: assume que o resto já foi visto e para de paginar.
    if (!sawNew) break;
    if (batch.length < SASI_MESSAGES_MAX_LIMIT) break;
    if (scanned >= SCAN_CAP) break;
    page += 1;
  }

  return { messages, maxId };
}

/**
 * Total por grupo: dentro do TTL, direto do banco (zero chamada à API).
 * Fora do TTL, sincroniza incrementalmente e persiste o resultado. Nunca
 * lança: falha de rede/API cai pro total salvo (mesmo vencido) em vez de
 * derrubar a tela de seleção.
 */
export async function getLiveGroupTotals(
  groups: CgcGroup[],
  userToken: string | null
): Promise<Record<string, number>> {
  const configured = groups.filter((group) => !groupIsUnconfigured(group));
  const stored = await getStoredTotals(configured.map((group) => group.id));

  const totals: Record<string, number> = {};
  const staleGroups: CgcGroup[] = [];
  for (const group of configured) {
    const row = stored[group.id];
    if (!isStale(row)) {
      totals[group.id] = row!.total;
    } else {
      staleGroups.push(group);
      if (row) totals[group.id] = row.total; // fallback se a sincronização falhar
    }
  }
  if (staleGroups.length === 0) return totals;

  const token = resolveSasiToken(userToken);
  if (!token) return totals;

  const clusters = new Map<string, CgcGroup[]>();
  for (const group of staleGroups) {
    const key = queryKey(groupToMessagesQuery(group));
    const list = clusters.get(key) ?? [];
    list.push(group);
    clusters.set(key, list);
  }

  try {
    for (const clusterGroups of clusters.values()) {
      const baseQuery = groupToMessagesQuery(clusterGroups[0]);
      const withRule = clusterGroups.filter((group) => groupToFieldRule(group));
      const withoutRule = clusterGroups.filter((group) => !groupToFieldRule(group));

      if (withoutRule.length > 0) {
        // Sem roteamento por campo: a contagem exata da API já resolve, sem
        // precisar buscar mensagem por mensagem — não há como incrementar.
        const count = await fetchProviderMessagesCount(baseQuery, { token }).catch(() => null);
        if (count !== null) {
          for (const group of withoutRule) {
            totals[group.id] = count;
            await saveGroupTotal(group.id, count, stored[group.id]?.lastMessageId ?? null);
          }
        }
      }

      if (withRule.length > 0) {
        // Se algum grupo do cluster nunca sincronizou, a varredura precisa
        // cobrir tudo (sinceId 0); do contrário, só o que passou do menor
        // last_message_id entre eles.
        const neverSynced = withRule.some((group) => (stored[group.id]?.lastMessageId ?? null) === null);
        const sinceId = neverSynced
          ? 0
          : Math.min(...withRule.map((group) => stored[group.id]!.lastMessageId!));

        const { messages } = await scanClusterSince(baseQuery, token, sinceId);

        for (const group of withRule) {
          const rule = groupToFieldRule(group);
          if (!rule) continue;

          const groupSinceId = stored[group.id]?.lastMessageId ?? 0;
          let newCount = 0;
          let maxId = groupSinceId;
          for (const message of messages) {
            const id = typeof message.id === "number" ? message.id : null;
            if (id === null || id <= groupSinceId) continue;
            if (id > maxId) maxId = id;
            if (messageMatchesFieldRule(message, rule)) newCount += 1;
          }

          const newTotal = (stored[group.id]?.total ?? 0) + newCount;
          totals[group.id] = newTotal;
          await saveGroupTotal(group.id, newTotal, maxId);
        }
      }
    }

    return totals;
  } catch (error) {
    if (error instanceof SasiApiError) return totals;
    throw error;
  }
}
