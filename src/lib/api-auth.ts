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

/**
 * Lê o corpo JSON da requisição. Devolve `null` quando o corpo está vazio, não
 * é JSON ou não é um objeto — antes `req.json()` lançava e a rota respondia
 * 500 com stack de erro; agora é um 400 limpo (ver `invalidBodyResponse`).
 */
export async function readJsonBody(req: { json(): Promise<unknown> }): Promise<Record<string, any> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, any>) : null;
  } catch {
    return null;
  }
}

export function invalidBodyResponse() {
  return NextResponse.json({ error: "Corpo da requisição inválido (JSON esperado)." }, { status: 400 });
}
