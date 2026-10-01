import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { invalidBodyResponse, readJsonBody, requireAuth } from "@/lib/api-auth";
import { isKnownStatus } from "@/lib/checklist-status";
import { v4 as uuidv4 } from "uuid";

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

  const body = await readJsonBody(req);
  if (!body) return invalidBodyResponse();
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
    // Antes qualquer texto era gravado como status e quebrava as cores e a
    // contagem de concluídos (que compara com 'CONCLUIDO').
    if (!isKnownStatus(status)) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }
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
  // Mesma transação: sem ela, a mudança podia ficar gravada sem a linha de
  // histórico correspondente (ou o contrário) se a segunda chamada falhasse.
  await db.batch(
    [
      {
        sql: `UPDATE activities SET ${updates.join(", ")} WHERE id = ?`,
        args,
      },
      {
        sql: `INSERT INTO history (id, activity_id, old_status, new_status, user_id, user_name, observation, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      },
    ],
    "write"
  );

  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if (!body) return invalidBodyResponse();
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

  const body = await readJsonBody(req);
  if (!body) return invalidBodyResponse();
  const { id, category } = body;

  if (!id && !category) {
    return NextResponse.json({ error: "ID ou categoria obrigatório" }, { status: 400 });
  }

  await initDb();
  const db = getDb();
  const checklistId = req.nextUrl.searchParams.get("checklist");

  // Observações e histórico não têm FK com cascade, então são apagados junto,
  // na mesma transação — antes ficavam órfãos apontando para atividade
  // inexistente (e o LEFT JOIN de /api/history os exibia sem nome).
  if (id) {
    await db.batch(
      [
        { sql: "DELETE FROM observations WHERE activity_id = ?", args: [id] },
        { sql: "DELETE FROM history WHERE activity_id = ?", args: [id] },
        { sql: "DELETE FROM activities WHERE id = ?", args: [id] },
      ],
      "write"
    );
    return NextResponse.json({ success: true });
  }

  // Sem checklist, o filtro era só a categoria — apagava a categoria em
  // todos os checklists de uma vez. Operação por categoria agora exige o
  // checklist; o /admin sempre envia, porque não abre sem ?checklist=.
  if (!checklistId) {
    return NextResponse.json(
      { error: "Informe o checklist para apagar uma categoria." },
      { status: 400 }
    );
  }

  const categoryName = String(category).trim();
  const inCategory = "SELECT id FROM activities WHERE category = ? AND checklist_id = ?";
  await db.batch(
    [
      { sql: `DELETE FROM observations WHERE activity_id IN (${inCategory})`, args: [categoryName, checklistId] },
      { sql: `DELETE FROM history WHERE activity_id IN (${inCategory})`, args: [categoryName, checklistId] },
      { sql: "DELETE FROM activities WHERE category = ? AND checklist_id = ?", args: [categoryName, checklistId] },
    ],
    "write"
  );
  return NextResponse.json({ success: true });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await readJsonBody(req);
  if (!body) return invalidBodyResponse();
  const { id, activity, category, oldCategory } = body;

  if (!id && !oldCategory && !category) {
    return NextResponse.json({ error: "Dados insuficientes para atualizar" }, { status: 400 });
  }

  await initDb();
  const db = getDb();
  const checklistId = req.nextUrl.searchParams.get("checklist");

  if (oldCategory && category) {
    // Mesmo motivo do DELETE: sem checklist, renomeava a categoria em todos.
    if (!checklistId) {
      return NextResponse.json(
        { error: "Informe o checklist para renomear uma categoria." },
        { status: 400 }
      );
    }
    await db.execute({
      sql: "UPDATE activities SET category = ? WHERE category = ? AND checklist_id = ?",
      args: [String(category).trim(), String(oldCategory).trim(), checklistId],
    });
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
