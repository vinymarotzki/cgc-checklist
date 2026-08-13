/**
 * Autenticação das rotas de API das Atividades do CGC.
 *
 * Mantém o mesmo contrato das rotas existentes (token em `sasi-token`/`token`,
 * bypass em host local) e devolve também o token cru, necessário para repassar
 * como Bearer à API SASI.
 *
 * As rotas do checklist continuam com a própria cópia de requireAuth — este
 * módulo não altera nenhuma delas.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateToken, type AuthUser } from "@/lib/auth";

export function isLocalRequest(host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

export type AuthResult =
  | { user: null; token: null; isLocal: boolean; error: NextResponse }
  | { user: AuthUser; token: string | null; isLocal: boolean; error: null };

export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  const token =
    req.nextUrl.searchParams.get("sasi-token") || req.nextUrl.searchParams.get("token");
  const host = req.headers.get("host") || req.nextUrl.host;
  const isLocal = isLocalRequest(host);

  if (!token && !isLocal) {
    return {
      user: null,
      token: null,
      isLocal,
      error: NextResponse.json({ error: "Token obrigatório" }, { status: 401 }),
    };
  }

  const user = token
    ? await authenticateToken(token)
    : isLocal
      ? { id: "local", name: "Local" }
      : null;

  if (!user) {
    return {
      user: null,
      token: null,
      isLocal,
      error: NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 }),
    };
  }

  return { user, token, isLocal, error: null };
}
