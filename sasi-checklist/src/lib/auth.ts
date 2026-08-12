export interface AuthUser {
  id: string;
  name: string;
  [key: string]: unknown;
}

export async function authenticateToken(token: string): Promise<AuthUser | null> {
  const endpoint = process.env.AUTH_USER_ENDPOINT;
  if (!endpoint) return null;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!response.ok) return null;
    return (await response.json()) as AuthUser;
  } catch {
    return null;
  }
}
