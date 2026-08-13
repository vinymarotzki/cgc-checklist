/**
 * Cliente HTTP da API SASI (Bone API).
 *
 * Camada única de acesso à rede: nenhuma outra parte do sistema deve montar URL
 * ou header de autenticação para api.bone.sasi.io. Só é executado no servidor —
 * o token nunca chega ao browser.
 *
 * Autenticação: Bearer JWT (securityScheme "bearer" do contrato OpenAPI).
 */

/** Categorias de falha que a interface precisa distinguir. */
export type SasiApiErrorKind =
  | "config"
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "network"
  | "http"
  | "parse";

export class SasiApiError extends Error {
  readonly kind: SasiApiErrorKind;
  readonly status: number | null;

  constructor(kind: SasiApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "SasiApiError";
    this.kind = kind;
    this.status = status;
  }
}

/** Base configurável para permitir apontar para outro ambiente sem alterar código. */
const DEFAULT_BASE_URL = "https://api.bone.sasi.io";
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Resolve qual token usar para falar com a API SASI.
 *
 * A API sempre exige Bearer — não existe leitura anônima. O token do header
 * `x-sasi-token` autentica o usuário em `AUTH_USER_ENDPOINT` (domínio
 * `api.sasi.io`), mas a Bone API (`api.bone.sasi.io`) só aceita token de
 * provider (`pat_…`, escopo `READ_MESSAGES`) — são credenciais de domínios
 * diferentes, uma não substitui a outra. Por isso `SASI_API_TOKEN` do
 * `.env.local` vem primeiro; o token do usuário só é tentado quando não há
 * `SASI_API_TOKEN` configurado.
 */
export function resolveSasiToken(userToken: string | null | undefined): string | null {
  const fromEnv = process.env.SASI_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const fromUser = userToken?.trim();
  return fromUser ? fromUser : null;
}

function getBaseUrl(): string {
  const raw = (process.env.SASI_API_BASE_URL || DEFAULT_BASE_URL).trim();
  return raw.replace(/\/+$/, "");
}

function getTimeoutMs(): number {
  const parsed = Number(process.env.SASI_API_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Remove params vazios e serializa tudo como string. */
function buildSearchParams(query: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (!text) continue;
    params.set(key, text);
  }
  return params;
}

function errorForStatus(status: number, body: string): SasiApiError {
  const detail = body.slice(0, 300);

  if (status === 401) {
    return new SasiApiError("auth", "Token inválido ou expirado na API SASI.", status);
  }
  if (status === 403) {
    return new SasiApiError(
      "forbidden",
      "Token sem permissão para ler mensagens do provider (escopo READ_MESSAGES).",
      status
    );
  }
  if (status === 404) {
    return new SasiApiError("not_found", "Recurso não encontrado na API SASI.", status);
  }
  if (status === 429) {
    return new SasiApiError("rate_limited", "Limite de requisições da API SASI atingido.", status);
  }
  return new SasiApiError("http", `API SASI respondeu ${status}. ${detail}`.trim(), status);
}

export interface SasiRequestOptions {
  /** Bearer token repassado à API SASI. */
  token: string;
  query?: Record<string, string | number | undefined | null>;
  /** Sobrescreve o timeout padrão (ms). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * GET autenticado na API SASI.
 *
 * Erros de rede, timeout, status HTTP e JSON inválido são normalizados em
 * SasiApiError — quem chama nunca recebe uma exceção crua de fetch.
 */
export async function sasiApiGet<T>(path: string, options: SasiRequestOptions): Promise<T> {
  const token = options.token?.trim();
  if (!token) {
    throw new SasiApiError("auth", "Token da API SASI não informado.");
  }

  const url = new URL(`${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
  if (options.query) {
    for (const [key, value] of buildSearchParams(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const timeoutMs = options.timeoutMs ?? getTimeoutMs();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new SasiApiError("timeout", `A API SASI não respondeu em ${timeoutMs}ms.`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new SasiApiError("network", `Falha de conexão com a API SASI. ${detail}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw errorForStatus(response.status, body);
  }

  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    throw new SasiApiError("parse", "A API SASI retornou uma resposta vazia.", response.status);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SasiApiError("parse", "A API SASI retornou um corpo que não é JSON válido.", response.status);
  }
}
