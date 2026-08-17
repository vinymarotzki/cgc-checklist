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
const authCache = new Map<string, { user: AuthUser; expiresAt: number }>();

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
    authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
    return user;
  } catch {
    return null;
  }
}
