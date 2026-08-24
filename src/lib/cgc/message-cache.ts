/**
 * Cache local das atividades do CGC, para a listagem de um grupo não escanear
 * a API SASI a cada request.
 *
 * Mesma técnica de `group-totals.ts` (marca d'água por `last_message_id`,
 * incremental, `GET /provider/messages` newest-first), mas aqui o que é
 * persistido é a atividade mapeada inteira, não só a contagem — assim busca,
 * filtro de status e paginação da listagem podem ler direto do banco em vez
 * de reconsultar o provider toda vez.
 *
 * TTL curto (`SYNC_TTL_MS`) porque o objetivo aqui é atividade nova aparecer
 * rápido, ao contrário do TTL de 2 min de `group-totals.ts` (só um número na
 * tela de seleção). Dentro do TTL a sincronização nem tenta: serve direto do
 * cache. Fora dele, tenta — mas como é incremental, o caso comum (nada novo)
 * resolve em uma chamada só, não nas ~5 de uma varredura completa.
 */

import { getDb, initDb } from "@/lib/db";
import { getStatuses, backfillGroup } from "./status-store";
import { groupIsUnconfigured, groupToFieldRule, groupToMessagesQuery, listGroups } from "./groups";
import { mapMessageToActivity, messageMatchesFieldRule } from "./mapper";
import { SasiApiError } from "@/lib/sasi-api/client";
import { SASI_MESSAGES_MAX_LIMIT, fetchProviderMessages } from "@/lib/sasi-api/messages";
import { getNotifySubscriptionKey, notifySubscription } from "@/lib/sasi-api/notify";
import type { SasiProviderMessage } from "@/lib/sasi-api/types";
import type { CgcActivity, CgcGroup } from "./types";

const SYNC_TTL_MS = 15 * 1000;

const SCAN_CAP = Number(process.env.SASI_CGC_SCAN_CAP) > 0
  ? Number(process.env.SASI_CGC_SCAN_CAP)
  : 500;

interface SyncState {
  lastMessageId: number | null;
  syncedAt: string;
}

async function getSyncState(groupId: string): Promise<SyncState | null> {
  await initDb();
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT last_message_id, synced_at FROM cgc_message_cache_sync WHERE group_id = ?",
    args: [groupId],
  });
  const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return null;
  const lastMessageId = row.last_message_id;
  return {
    lastMessageId: lastMessageId === null || lastMessageId === undefined ? null : Number(lastMessageId),
    syncedAt: String(row.synced_at),
  };
}

async function saveSyncState(groupId: string, lastMessageId: number | null): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO cgc_message_cache_sync (group_id, last_message_id, synced_at)
          VALUES (?, ?, ?)
          ON CONFLICT(group_id) DO UPDATE SET
            last_message_id = excluded.last_message_id,
            synced_at = excluded.synced_at`,
    args: [groupId, lastMessageId, new Date().toISOString()],
  });
}

function isStale(state: SyncState | null): boolean {
  if (!state) return true;
  return Date.now() - new Date(state.syncedAt).getTime() >= SYNC_TTL_MS;
}

/**
 * Reivindica a sincronização do grupo de forma atômica, pra evitar o notify
 * duplicado: com poll do client (15s), cron do GitHub Actions (5min) e agora
 * o webhook (instantâneo) todos podendo cair no mesmo grupo quase ao mesmo
 * tempo, um simples "lê o estado, depois de buscar tudo grava o novo estado"
 * deixava duas chamadas concorrentes lerem o mesmo estado obsoleto, ambas
 * buscarem a mesma atividade "nova" e ambas dispararem notifySubscription.
 *
 * Compare-and-swap em `synced_at`: só quem conseguir mover o timestamp (via
 * UPDATE condicional ou INSERT que não colide) segue em frente; quem perder
 * a corrida recebe null e sai sem tocar em nada, sem novo notify.
 */
async function tryClaimSync(groupId: string): Promise<SyncState | null> {
  await initDb();
  const db = getDb();
  const state = await getSyncState(groupId);
  if (!isStale(state)) return null;

  const now = new Date().toISOString();

  if (!state) {
    const result = await db.execute({
      sql: `INSERT INTO cgc_message_cache_sync (group_id, last_message_id, synced_at)
            VALUES (?, NULL, ?)
            ON CONFLICT(group_id) DO NOTHING`,
      args: [groupId, now],
    });
    if (Number(result.rowsAffected) === 0) return null;
    return { lastMessageId: null, syncedAt: now };
  }

  const result = await db.execute({
    sql: `UPDATE cgc_message_cache_sync SET synced_at = ? WHERE group_id = ? AND synced_at = ?`,
    args: [now, groupId, state.syncedAt],
  });
  if (Number(result.rowsAffected) === 0) return null;
  return state;
}

async function upsertActivity(groupId: string, activity: CgcActivity): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO cgc_message_cache (message_id, group_id, data_json, cached_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(message_id) DO UPDATE SET
            data_json = excluded.data_json,
            cached_at = excluded.cached_at`,
    args: [activity.id, groupId, JSON.stringify(activity), new Date().toISOString()],
  });
}

/** Quantas páginas buscar em paralelo no scan a frio — ver nota abaixo. */
const COLD_SCAN_CONCURRENCY = 5;

/**
 * Processa uma página já buscada: grava no cache o que é novo (id > sinceId)
 * e casa com a regra de campo do grupo. Devolve o maior id visto e se havia
 * algo novo na página (usado só pelo scan sequencial, pra decidir se para).
 */
async function ingestBatch(
  batch: SasiProviderMessage[],
  group: CgcGroup,
  fieldRule: ReturnType<typeof groupToFieldRule>,
  sinceId: number
): Promise<{ maxId: number; sawNew: boolean; matched: number }> {
  let maxId = sinceId;
  let sawNew = false;
  let matched = 0;

  for (const message of batch) {
    const id = typeof message.id === "number" ? message.id : null;
    if (id === null || id <= sinceId) continue;
    sawNew = true;
    if (id > maxId) maxId = id;

    if (fieldRule && !messageMatchesFieldRule(message, fieldRule)) continue;

    try {
      const activity = mapMessageToActivity(message, { groupName: group.name });
      await upsertActivity(group.id, activity);
      matched += 1;
    } catch {
      // Mensagem irrecuperável: pula, não derruba a sincronização inteira.
    }
  }

  return { maxId, sawNew, matched };
}

/**
 * Sincroniza o cache do grupo com o que há de novo na API SASI, respeitando o
 * TTL. Não lança: falha de rede/API deixa o cache como está (ainda servível,
 * só desatualizado) em vez de derrubar a listagem.
 */
export async function syncGroupMessages(group: CgcGroup, token: string): Promise<void> {
  if (groupIsUnconfigured(group)) return;

  const state = await tryClaimSync(group.id);
  if (!state) return;

  const sinceId = state.lastMessageId ?? 0;
  const baseQuery = groupToMessagesQuery(group);
  const fieldRule = groupToFieldRule(group);

  try {
    let maxId = sinceId;
    let newlyMatched = 0;

    if (sinceId === 0) {
      // Primeira sincronização do grupo (cache vazio): não há marca d'água
      // pra decidir "parar cedo" — toda mensagem do canal conta como nova de
      // qualquer forma. Buscar as páginas do teto (SCAN_CAP) em paralelo em
      // vez de uma de cada vez corta a espera de ~5x a latência da API SASI
      // pra ~1x, que é o motivo da lista demorar tanto pra aparecer na
      // primeira visita a um grupo.
      // allSettled em vez de all: a API SASI responde 500 (em vez de array
      // vazio) pra página além do fim dos dados — muito comum aqui, já que a
      // maioria dos grupos cabe inteira numa página só. Com Promise.all, essa
      // rejeição abortava o Promise.all inteiro (silenciada pelo catch de
      // SasiApiError lá embaixo) e o cache nunca chegava a ser gravado.
      const maxPages = Math.ceil(SCAN_CAP / SASI_MESSAGES_MAX_LIMIT);
      for (let start = 1; start <= maxPages; start += COLD_SCAN_CONCURRENCY) {
        const pages = Array.from(
          { length: Math.min(COLD_SCAN_CONCURRENCY, maxPages - start + 1) },
          (_, i) => start + i
        );
        const settled = await Promise.allSettled(
          pages.map((page) =>
            fetchProviderMessages({ ...baseQuery, page, limit: SASI_MESSAGES_MAX_LIMIT }, { token })
          )
        );

        let sawEmptyPage = false;
        for (const outcome of settled) {
          if (outcome.status === "rejected") {
            if (!(outcome.reason instanceof SasiApiError)) throw outcome.reason;
            // Trata como "fim dos dados", não como falha real.
            sawEmptyPage = true;
            continue;
          }
          const batch = outcome.value;
          if (batch.length === 0) {
            sawEmptyPage = true;
            continue;
          }
          const { maxId: batchMaxId } = await ingestBatch(batch, group, fieldRule, sinceId);
          if (batchMaxId > maxId) maxId = batchMaxId;
        }
        if (sawEmptyPage) break;
      }
    } else {
      // Já sincronizado antes: varredura incremental sequencial, que resolve
      // em zero ou uma chamada no caso comum (nada novo desde o último poll).
      let scanned = 0;
      let page = 1;

      while (scanned < SCAN_CAP) {
        const batch: SasiProviderMessage[] = await fetchProviderMessages(
          { ...baseQuery, page, limit: SASI_MESSAGES_MAX_LIMIT },
          { token }
        );
        if (batch.length === 0) break;
        scanned += batch.length;

        const { maxId: batchMaxId, sawNew, matched } = await ingestBatch(batch, group, fieldRule, sinceId);
        if (batchMaxId > maxId) maxId = batchMaxId;
        newlyMatched += matched;

        // Página sem nada novo: assume que o resto já foi visto e para de paginar.
        if (!sawNew) break;
        if (batch.length < SASI_MESSAGES_MAX_LIMIT) break;
        if (scanned >= SCAN_CAP) break;
        page += 1;
      }
    }

    await saveSyncState(group.id, maxId);

    // Só avisa em cima do incremental (sinceId > 0): a primeira sincronização
    // de um grupo (backfill) não deve virar uma enxurrada de push sobre
    // atividade velha. Best-effort — nunca derruba a sincronização.
    if (sinceId > 0 && newlyMatched > 0) {
      const text = newlyMatched === 1
        ? `1 nova atividade em ${group.name}.`
        : `${newlyMatched} novas atividades em ${group.name}.`;
      await notifySubscription(getNotifySubscriptionKey(), { title: "Atividades do CGC", text });
    }
  } catch (error) {
    if (error instanceof SasiApiError) return;
    throw error;
  }
}

export interface SyncAllGroupsResult {
  synced: number;
  total: number;
  failed: string[];
}

/**
 * Sincroniza todos os grupos configurados de uma vez — usado tanto pelo cron
 * externo (GitHub Actions) quanto pela rota de webhook, que não tenta parsear
 * o payload que a API SASI manda (formato não documentado); só usa a chamada
 * como sinal de "algo mudou, verifica agora" e deixa syncGroupMessages (com
 * seu TTL e marca d'água) fazer o trabalho de verdade, grupo por grupo.
 */
export async function syncAllGroups(token: string): Promise<SyncAllGroupsResult> {
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
    console.error(`[cgc-sync-all] falha ao sincronizar grupo "${group.name}": ${reason.reason}`);
  }

  return {
    synced: groups.length - failed.length,
    total: groups.length,
    failed: failed.map(({ group }) => group.name),
  };
}

/** Busca pontual por id, direto do cache — usado pelo export do /controle. */
export async function getCachedActivitiesByIds(ids: string[]): Promise<Map<string, CgcActivity>> {
  const out = new Map<string, CgcActivity>();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return out;

  await initDb();
  const db = getDb();

  const BATCH_SIZE = 200;
  for (let start = 0; start < uniqueIds.length; start += BATCH_SIZE) {
    const batch = uniqueIds.slice(start, start + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db.execute({
      sql: `SELECT message_id, data_json FROM cgc_message_cache WHERE message_id IN (${placeholders})`,
      args: batch,
    });
    for (const row of result.rows as unknown as { message_id: string; data_json: string }[]) {
      try {
        out.set(row.message_id, JSON.parse(row.data_json) as CgcActivity);
      } catch {
        // Linha corrompida: ignora, chamador trata como não encontrada.
      }
    }
  }

  return out;
}

export interface ListActivitiesParams {
  page: number;
  limit: number;
  search?: string;
}

export interface ListActivitiesResult {
  activities: CgcActivity[];
  total: number;
}

/**
 * Lê a listagem do cache local (busca, status atual e paginação aplicados
 * aqui, sem nova chamada à API SASI). Chamar `syncGroupMessages` antes.
 */
export async function listGroupActivities(
  groupId: string,
  params: ListActivitiesParams
): Promise<ListActivitiesResult> {
  await initDb();
  const db = getDb();

  const result = await db.execute({
    sql: "SELECT data_json FROM cgc_message_cache WHERE group_id = ?",
    args: [groupId],
  });

  let activities: CgcActivity[] = (result.rows as unknown as { data_json: string }[])
    .map((row) => {
      try {
        return JSON.parse(row.data_json) as CgcActivity;
      } catch {
        return null;
      }
    })
    .filter((activity): activity is CgcActivity => activity !== null);

  const search = params.search?.trim().toLowerCase();
  if (search) {
    activities = activities.filter((activity) =>
      activity.description?.toLowerCase().includes(search)
    );
  }

  activities.sort((a, b) => (b.messageId ?? 0) - (a.messageId ?? 0));

  const ids = activities.map((activity) => activity.id);
  if (ids.length > 0) {
    await backfillGroup(ids, groupId);
    const statuses = await getStatuses(ids);
    activities = activities.map((activity) => {
      const status = statuses.get(activity.id);
      return status ? { ...activity, status } : activity;
    });
  }

  const total = activities.length;
  const start = (params.page - 1) * params.limit;
  const slice = activities.slice(start, start + params.limit);

  return { activities: slice, total };
}
