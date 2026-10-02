export interface AuthUser {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * O AUTH_USER_ENDPOINT é lento (segundos) e toda rota de API o chama de
 * novo — o polling de 15s das Atividades do CGC sozinho gera várias chamadas
 * por ciclo com o mesmo token. Um cache curto em memória (mesmo padrão de
 * `group-totals.ts`) evita pagar essa latência de novo a cada requisição sem
 * deixar um token revogado valer por muito tempo.
 */
const AUTH_CACHE_TTL_MS = 60_000;
// Sem teto, cada token distinto que autenticava ficava no Map até o processo
// morrer. Limpa os vencidos quando passa do limite e, se ainda estiver cheio,
// descarta o mais antigo (o Map mantém ordem de inserção).
const AUTH_CACHE_MAX_ENTRIES = 500;
const authCache = new Map<string, { user: AuthUser; expiresAt: number }>();

function rememberUser(token: string, user: AuthUser) {
  authCache.delete(token);
  if (authCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of authCache) {
      if (entry.expiresAt <= now) authCache.delete(key);
    }
    if (authCache.size >= AUTH_CACHE_MAX_ENTRIES) {
      const oldest = authCache.keys().next().value;
      if (oldest !== undefined) authCache.delete(oldest);
    }
  }
  authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
}

export async function authenticateToken(token: string): Promise<AuthUser | null> {
  const endpoint = process.env.AUTH_USER_ENDPOINT;
  if (!endpoint) return null;

  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!response.ok) {
      authCache.delete(token);
      return null;
    }

    const user = (await response.json()) as AuthUser;
    rememberUser(token, user);
    return user;
  } catch {
    return null;
  }
}
