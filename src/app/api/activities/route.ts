import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { authenticateToken } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

function isLocalRequest(host: string | null) {
  return !!host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

async function requireAuth(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("sasi-token") || req.nextUrl.searchParams.get("token");
  const host = req.headers.get("host") || req.nextUrl.host;
  const local = isLocalRequest(host);

  if (!token && !local) {
    return { user: null, error: NextResponse.json({ error: "Token obrigatório" }, { status: 401 }) };
  }

  const user = token ? await authenticateToken(token) : local ? { id: "local", name: "Local" } : null;
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 }) };
  }

  return { user, error: null };
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  await initDb();
  const db = getDb();
  const checklistId = req.nextUrl.searchParams.get("checklist");
  const result = checklistId
    ? await db.execute({
        sql: "SELECT * FROM activities WHERE checklist_id = ? ORDER BY category, rowid",
        args: [checklistId],
      })
    : await db.execute("SELECT * FROM activities ORDER BY category, rowid");

  return NextResponse.json({ activities: result.rows, user: auth.user });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const { id, status, responsible, observation } = body;

  if (!id) {
    return NextResponse.json({ error: "ID da atividade obrigatório" }, { status: 400 });
  }

  await initDb();
  const db = getDb();

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

  await db.execute({
    sql: `INSERT INTO history (id, activity_id, old_status, new_status, user_id, user_name, observation, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)` ,
    args: [
      uuidv4(),
      id,
      oldActivity.status,
      status ?? oldActivity.status,
      String(auth.user.id),
      String(auth.user.name),
      observation ?? null,
      new Date().toISOString(),
    ],
  });

  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const { category, activity } = body;
  const checklistId = req.nextUrl.searchParams.get("checklist") || body.checklist_id;

  if (!category || !activity) {
    return NextResponse.json({ error: "Categoria e atividade são obrigatórios" }, { status: 400 });
  }

  await initDb();
  const db = getDb();
  const id = uuidv4();
  await db.execute({
    sql: "INSERT INTO activities (id, category, activity, status, responsible, observation, checklist_id) VALUES (?, ?, ?, 'SEM_STATUS', NULL, NULL, ?)",
    args: [id, String(category).trim(), String(activity).trim(), checklistId ? String(checklistId) : null],
  });

  return NextResponse.json({ success: true, activity: { id, category: String(category).trim(), activity: String(activity).trim() } });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const { id, category } = body;

  if (!id && !category) {
    return NextResponse.json({ error: "ID ou categoria obrigatório" }, { status: 400 });
  }

  await initDb();
  const db = getDb();
  const checklistId = req.nextUrl.searchParams.get("checklist");

  if (id) {
    await db.execute({ sql: "DELETE FROM activities WHERE id = ?", args: [id] });
    return NextResponse.json({ success: true });
  }

  if (checklistId) {
    await db.execute({
      sql: "DELETE FROM activities WHERE category = ? AND checklist_id = ?",
      args: [String(category).trim(), checklistId],
    });
    return NextResponse.json({ success: true });
  }

  await db.execute({ sql: "DELETE FROM activities WHERE category = ?", args: [String(category).trim()] });
  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json();
  const { id, activity, category, oldCategory } = body;

  if (!id && !oldCategory && !category) {
    return NextResponse.json({ error: "Dados insuficientes para atualizar" }, { status: 400 });
  }

  await initDb();
  const db = getDb();
  const checklistId = req.nextUrl.searchParams.get("checklist");

  if (oldCategory && category) {
    if (checklistId) {
      await db.execute({
        sql: "UPDATE activities SET category = ? WHERE category = ? AND checklist_id = ?",
        args: [String(category).trim(), String(oldCategory).trim(), checklistId],
      });
      return NextResponse.json({ success: true });
    }
    await db.execute({ sql: "UPDATE activities SET category = ? WHERE category = ?", args: [String(category).trim(), String(oldCategory).trim()] });
    return NextResponse.json({ success: true });
  }

  if (!id) {
    return NextResponse.json({ error: "ID da atividade obrigatório" }, { status: 400 });
  }

  const updates: string[] = [];
  const args: (string | null)[] = [];

  if (activity !== undefined) {
    updates.push("activity = ?");
    args.push(String(activity).trim());
  }
  if (category !== undefined) {
    updates.push("category = ?");
    args.push(String(category).trim());
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  args.push(id);
  await db.execute({
    sql: `UPDATE activities SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  return NextResponse.json({ success: true });
}
