/**
 * Push de notificação da API SASI — host e credencial diferentes da Bone API.
 *
 * `client.ts` fala com `api.bone.sasi.io` (leitura de mensagens, token
 * `pat_…` escopo READ_MESSAGES). Este módulo fala com `api.sasi.io`
 * (`POST /api/v2/providers/subscriptions/{key}/notify`), que exige um Bearer
 * JWT diferente — autoriza notificação, não leitura de mensagens. Uma
 * credencial não substitui a outra (mesma lógica de `resolveSasiToken`, dois
 * domínios distintos).
 *
 * Nunca lança: falha aqui não pode derrubar a sincronização que a chamou —
 * mesmo padrão de `recordHistory` (silencioso, best-effort).
 */

const DEFAULT_NOTIFY_BASE_URL = "https://api.sasi.io";
const DEFAULT_TIMEOUT_MS = 8000;

function getNotifyBaseUrl(): string {
  const raw = (process.env.SASI_NOTIFY_API_BASE_URL || DEFAULT_NOTIFY_BASE_URL).trim();
  return raw.replace(/\/+$/, "");
}

function getNotifyToken(): string | null {
  const token = process.env.SASI_NOTIFY_TOKEN?.trim();
  return token ? token : null;
}

/** Chave de subscription notificada — mesma pros quatro grupos seedados por ora. */
export function getNotifySubscriptionKey(): string {
  return (process.env.SASI_NOTIFY_SUBSCRIPTION_KEY || "app:1619").trim();
}

export interface NotifyPayload {
  title?: string;
  text: string;
}

/**
 * Envia push pra todo mundo inscrito na subscription `key`.
 *
 * Sem `SASI_NOTIFY_TOKEN` configurado, é um no-op silencioso — assim o
 * recurso fica desligado até a credencial existir, sem precisar de feature
 * flag separada nem quebrar quem ainda não configurou.
 */
export async function notifySubscription(key: string, payload: NotifyPayload): Promise<void> {
  const token = getNotifyToken();
  if (!token) return;

  try {
    const url = `${getNotifyBaseUrl()}/api/v2/providers/subscriptions/${encodeURIComponent(key)}/notify`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[sasi-notify] ${response.status} ao notificar "${key}": ${body.slice(0, 300)}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[sasi-notify] falha ao notificar "${key}": ${detail}`);
  }
}
