/**
 * CRUD dos grupos das Atividades do CGC.
 *
 * O grupo é local (tabela cgc_groups) e guarda o recorte de filtros que será
 * repassado a GET /provider/messages da API SASI.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  updateGroup,
  type CgcGroupInput,
} from "@/lib/cgc/groups";
import { getConcludedCountByGroup } from "@/lib/cgc/status-store";

function parseGroupInput(body: unknown): CgcGroupInput | null {
  if (typeof body !== "object" || body === null) return null;
  const source = body as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) return null;

  const text = (value: unknown) => (typeof value === "string" ? value : null);

  return {
    name,
    category_ids: text(source.category_ids),
    team_name: text(source.team_name),
    channel_ids: text(source.channel_ids),
    app_ids: text(source.app_ids),
  };
}

async function readJson(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const [groups, concluded] = await Promise.all([
      listGroups(),
      // Contagem local: não custa chamada à API SASI, então os cards podem
      // mostrar o andamento sem esperar por rede externa.
      getConcludedCountByGroup().catch(() => ({} as Record<string, number>)),
    ]);

    return NextResponse.json({
      groups: groups.map((group) => ({ ...group, concluded: concluded[group.id] ?? 0 })),
      user: auth.user,
    });
  } catch {
    return NextResponse.json({ error: "Falha ao carregar os grupos." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const input = parseGroupInput(await readJson(req));
  if (!input) {
    return NextResponse.json({ error: "Nome do grupo obrigatório" }, { status: 400 });
  }

  try {
    const group = await createGroup(input, {
      id: String(auth.user.id),
      name: String(auth.user.name),
    });
    return NextResponse.json({ success: true, group });
  } catch {
    return NextResponse.json({ error: "Falha ao criar o grupo." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await readJson(req);
  const id =
    typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).id === "string"
      ? ((body as Record<string, unknown>).id as string).trim()
      : "";

  if (!id) {
    return NextResponse.json({ error: "ID do grupo obrigatório" }, { status: 400 });
  }

  const input = parseGroupInput(body);
  if (!input) {
    return NextResponse.json({ error: "Nome do grupo obrigatório" }, { status: 400 });
  }

  try {
    if (!(await getGroup(id))) {
      return NextResponse.json({ error: "Grupo não encontrado" }, { status: 404 });
    }
    await updateGroup(id, input);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Falha ao atualizar o grupo." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await readJson(req);
  const id =
    typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).id === "string"
      ? ((body as Record<string, unknown>).id as string).trim()
      : "";

  if (!id) {
    return NextResponse.json({ error: "ID do grupo obrigatório" }, { status: 400 });
  }

  try {
    await deleteGroup(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Falha ao excluir o grupo." }, { status: 500 });
  }
}
