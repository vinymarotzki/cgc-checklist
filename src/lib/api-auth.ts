import { NextResponse } from "next/server";
import { authenticateToken, type AuthUser } from "@/lib/auth";
import { NO_ACCESS_MESSAGE, readSasiTokenHeader, type ReadableHeaders } from "@/lib/token";

/**
 * Versão compartilhada do `requireAuth` que cada rota do checklist ainda
 * carrega como cópia privada. Criada para as rotas de /controle, que até
 * aqui eram públicas — qualquer um que soubesse a URL lia os checklists
 * finalizados e, pelo proxy, os dados do cgc-atividades já autenticados com
 * CONTROLE_PROXY_SECRET. Mesma regra das cópias: token só pelo header
 * `x-sasi-token`, validado contra AUTH_USER_ENDPOINT.
 */
export async function requireAuth(
  req: { headers: ReadableHeaders }
): Promise<{ user: AuthUser; error: null } | { user: null; error: NextResponse }> {
  const token = readSasiTokenHeader(req.headers);

  if (!token) {
    return { user: null, error: NextResponse.json({ error: NO_ACCESS_MESSAGE }, { status: 401 }) };
  }

  const user = await authenticateToken(token);
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 }) };
  }

  return { user, error: null };
}
