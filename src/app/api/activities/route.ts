import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/sasi";
import { v4 as uuidv4 } from "uuid";

function isLocalRequest(host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("sasi-token") || req.nextUrl.searchParams.get("token");
  const host = req.headers.get("host") || req.nextUrl.host;
  const local = isLocalRequest(host);

  if (!token && !local) {
    return NextResponse.json({ error: "Token obrigatório" }, { status: 401 });
  }

  const user = token ? await authenticateToken(token) : local ? { id: "local", name: "Local" } : null;
  if (!user) {
    return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 });
  }

  await initDb();
  const db = getDb();
  const result = await db.execute("SELECT * FROM activities ORDER BY category, rowid");

  return NextResponse.json({ activities: result.rows, user });
}

export async function PATCH(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("sasi-token") || req.nextUrl.searchParams.get("token");
  const host = req.headers.get("host") || req.nextUrl.host;
  const local = isLocalRequest(host);

  if (!token && !local) {
    return NextResponse.json({ error: "Token obrigatório" }, { status: 401 });
  }

  const user = token ? await authenticateToken(token) : local ? { id: "local", name: "Local" } : null;
  if (!user) {
    return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 });
  }

  const body = await req.json();
  const { id, status, responsible, observation } = body;

  if (!id) {
    return NextResponse.json({ error: "ID da atividade obrigatório" }, { status: 400 });
  }

  await initDb();
  const db = getDb();

  // Get current activity
  const current = await db.execute({
    sql: "SELECT * FROM activities WHERE id = ?",
    args: [id],
  });

  if (current.rows.length === 0) {
    return NextResponse.json({ error: "Atividade não encontrada" }, { status: 404 });
  }

  const oldActivity = current.rows[0] as unknown as {
    id: string;
    status: string;
    responsible: string;
    observation: string;
  };

  // Build update fields dynamically
  const updates: string[] = [];
  const args: (string | null)[] = [];

  if (status !== undefined) {
    updates.push("status = ?");
    args.push(status);
  }
  if (responsible !== undefined) {
    updates.push("responsible = ?");
    args.push(responsible);
  }
  if (observation !== undefined) {
    updates.push("observation = ?");
    args.push(observation);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  args.push(id);
  await db.execute({
    sql: `UPDATE activities SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  // Log to history
  await db.execute({
    sql: `INSERT INTO history (id, activity_id, old_status, new_status, user_id, user_name, observation, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      uuidv4(),
      id,
      oldActivity.status,
      status ?? oldActivity.status,
      String(user.id),
      String(user.name),
      observation ?? null,
      new Date().toISOString(),
    ],
  });

  return NextResponse.json({ success: true });
}
