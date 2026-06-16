import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/sasi";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token obrigatório" }, { status: 401 });
  }

  const user = await authenticateToken(token);
  if (!user) {
    return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 });
  }

  await initDb();
  const db = getDb();

  const result = await db.execute(`
    SELECT h.*, a.activity, a.category
    FROM history h
    LEFT JOIN activities a ON h.activity_id = a.id
    ORDER BY h.created_at DESC
    LIMIT 200
  `);

  return NextResponse.json({ history: result.rows, user });
}
