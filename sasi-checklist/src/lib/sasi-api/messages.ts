/**
 * Serviço do recurso Messages da API SASI.
 *
 * Endpoints usados (contrato em https://api.bone.sasi.io/api-json):
 *   GET /provider/messages        — lista paginada, retorna array puro
 *   GET /provider/messages/count  — contagem exata, mesmos filtros
 *
 * A lista não vem envelopada e não traz total; por isso o total sai do /count.
 */

import { SasiApiError, sasiApiGet, type SasiRequestOptions } from "./client";
import type { SasiMessagesQuery, SasiProviderMessage } from "./types";

export const SASI_MESSAGES_PATH = "/provider/messages";
export const SASI_MESSAGES_COUNT_PATH = "/provider/messages/count";

/** Default declarado no contrato. */
export const SASI_MESSAGES_DEFAULT_LIMIT = 10;
/** Máximo declarado no contrato — valores maiores são rejeitados pela API. */
export const SASI_MESSAGES_MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isFinite(limit)) return undefined;
  return Math.min(Math.max(Math.trunc(limit), 1), SASI_MESSAGES_MAX_LIMIT);
}

function clampPage(page: number | undefined): number | undefined {
  if (page === undefined) return undefined;
  if (!Number.isFinite(page)) return undefined;
  return Math.max(Math.trunc(page), 1);
}

/**
 * Normaliza a query para os nomes exatos aceitos pelo endpoint.
 * Qualquer chave fora desta lista é descartada — nada é inventado.
 */
export function buildMessagesQuery(query: SasiMessagesQuery = {}) {
  return {
    page: clampPage(query.page),
    limit: clampLimit(query.limit),
    search: query.search,
    category_ids: query.category_ids,
    app_ids: query.app_ids,
    channel_ids: query.channel_ids,
    team_name: query.team_name,
    contact_name: query.contact_name,
    status_ids: query.status_ids,
    date: query.date,
    exclude_status_ids: query.exclude_status_ids,
    exclude_channel_ids: query.exclude_channel_ids,
    exclude_category_ids: query.exclude_category_ids,
    exclude_app_ids: query.exclude_app_ids,
  };
}

type ServiceOptions = Omit<SasiRequestOptions, "query">;

/** GET /provider/messages. Sempre resolve em array, mesmo se a API devolver outra forma. */
export async function fetchProviderMessages(
  query: SasiMessagesQuery,
  options: ServiceOptions
): Promise<SasiProviderMessage[]> {
  const payload = await sasiApiGet<unknown>(SASI_MESSAGES_PATH, {
    ...options,
    query: buildMessagesQuery(query),
  });

  if (Array.isArray(payload)) {
    return payload as SasiProviderMessage[];
  }

  // Tolerância a um eventual envelope: aproveita a lista se ela vier aninhada.
  if (payload && typeof payload === "object") {
    for (const key of ["data", "items", "messages", "results"]) {
      const nested = (payload as Record<string, unknown>)[key];
      if (Array.isArray(nested)) return nested as SasiProviderMessage[];
    }
  }

  throw new SasiApiError("parse", "A API SASI retornou um formato inesperado para mensagens.");
}

/** GET /provider/messages/count. Retorna null se a contagem não estiver disponível. */
export async function fetchProviderMessagesCount(
  query: SasiMessagesQuery,
  options: ServiceOptions
): Promise<number | null> {
  const payload = await sasiApiGet<{ count?: unknown }>(SASI_MESSAGES_COUNT_PATH, {
    ...options,
    query: buildMessagesQuery(query),
  });

  const count = Number(payload?.count);
  return Number.isFinite(count) ? count : null;
}
