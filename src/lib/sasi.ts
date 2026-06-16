export interface SasiUser {
  id: string;
  name: string;
  [key: string]: unknown;
}

export async function authenticateToken(token: string): Promise<SasiUser | null> {
  try {
    const response = await fetch("https://api.sasi.io/api/v2/providers/external/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data as SasiUser;
  } catch {
    return null;
  }
}
