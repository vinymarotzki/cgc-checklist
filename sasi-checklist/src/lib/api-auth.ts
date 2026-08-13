/**
 * Autenticação das rotas de API das Atividades do CGC.
 *
 * O token só é lido de `sasi-token` na URL (ver `@/lib/token`). Não há mais
 * fallback para `token` nem bypass por host local: sem token no modelo
 * esperado, a requisição é recusada em qualquer ambiente.
 *
 * Devolve também o token cru, necessário para repassar como Bearer à API SASI.
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateToken, type AuthUser } from "@/lib/auth";
import { NO_ACCESS_MESSAGE, readSasiToken } from "@/lib/token";

export type AuthResult =
  | { user: null; token: null; error: NextResponse }
  | { user: AuthUser; token: string; error: null };

export async function requireAuth(req: NextRequest): Promise<AuthResult> {
  const token = readSasiToken(req.nextUrl.searchParams);

  if (!token) {
    return {
      user: null,
      token: null,
      error: NextResponse.json({ error: NO_ACCESS_MESSAGE }, { status: 401 }),
    };
  }

  const user = await authenticateToken(token);
  if (!user) {
    return {
      user: null,
      token: null,
      error: NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 }),
    };
  }

  return { user, token, error: null };
}
