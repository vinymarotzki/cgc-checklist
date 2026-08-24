/**
 * Atividades concluídas de um grupo do CGC, para exportar XLSX em /controle.
 *
 * Rota pública de propósito (ver /api/controle/checklists). O provider token
 * vem de SASI_API_TOKEN (`resolveSasiToken(null)`), nunca do usuário — /controle
 * não tem sasi-token nenhum.
 *
 * As atividades concluídas (quais message_id, quem concluiu, quando) vêm de
 * cgc_activity_status, que é local. Descrição/prazo só existem na
 * API SASI, então o grupo é varrido (mesmo limite SASI_CGC_SCAN_CAP de
 * /api/cgc/activities) para montar esses campos; uma concluída que caia fora
 * do teto de varredura ainda aparece na planilha, só sem esses detalhes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import {
  getGroup,
  groupIsUnconfigured,
  groupToFieldRule,
  groupToMessagesQuery,
} from "@/lib/cgc/groups";
import { mapMessagesToActivities, messageMatchesFieldRule } from "@/lib/cgc/mapper";
import { SasiApiError, resolveSasiToken } from "@/lib/sasi-api/client";
import { SASI_MESSAGES_MAX_LIMIT, fetchProviderMessages } from "@/lib/sasi-api/messages";
import type { SasiProviderMessage } from "@/lib/sasi-api/types";

const SCAN_CAP = Number(process.env.SASI_CGC_SCAN_CAP) > 0
  ? Number(process.env.SASI_CGC_SCAN_CAP)
  : 500;

interface ConcludedRow {
  message_id: string;
  user_name: string | null;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  const groupId = req.nextUrl.searchParams.get("group")?.trim();
  if (!groupId) {
    return NextResponse.json({ error: "Selecione um grupo." }, { status: 400 });
  }

  await initDb();
  const db = getDb();

  const group = await getGroup(groupId);
  if (!group) {
    return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });
  }

  const concludedResult = await db.execute({
    sql: `SELECT message_id, user_name, updated_at FROM cgc_activity_status
          WHERE group_id = ? AND status = 'CONCLUIDO'`,
    args: [groupId],
  });
  const concludedRows = concludedResult.rows as unknown as ConcludedRow[];

  if (concludedRows.length === 0 || groupIsUnconfigured(group)) {
    return NextResponse.json({ group: { id: group.id, name: group.name }, activities: [] });
  }

  const observationsResult = await db.execute({
    sql: `SELECT message_id, text FROM cgc_observations ORDER BY created_at ASC`,
    args: [],
  });
  const commentsByMessage = new Map<string, string[]>();
  for (const row of observationsResult.rows as unknown as { message_id: string; text: string }[]) {
    const list = commentsByMessage.get(row.message_id) ?? [];
    list.push(row.text);
    commentsByMessage.set(row.message_id, list);
  }

  const sasiToken = resolveSasiToken(null);
  if (!sasiToken) {
    return NextResponse.json(
      { error: "Token da API SASI (SASI_API_TOKEN) não configurado no servidor." },
      { status: 500 }
    );
  }

  const baseQuery = groupToMessagesQuery(group);
  const fieldRule = groupToFieldRule(group);
  const detailsByMessageId = new Map<string, { description: string; deadline: string | null }>();

  try {
    let scanned = 0;
    let page = 1;

    while (scanned < SCAN_CAP) {
      const batch: SasiProviderMessage[] = await fetchProviderMessages(
        { ...baseQuery, page, limit: SASI_MESSAGES_MAX_LIMIT },
        { token: sasiToken }
      );
      scanned += batch.length;

      const relevant = fieldRule
        ? batch.filter((message) => messageMatchesFieldRule(message, fieldRule))
        : batch;
      const { activities } = mapMessagesToActivities(relevant, { groupName: group.name });
      for (const activity of activities) {
        detailsByMessageId.set(activity.id, {
          description: activity.description,
          deadline: activity.deadline?.label ?? null,
        });
      }

      if (batch.length < SASI_MESSAGES_MAX_LIMIT) break;
      if (scanned >= SCAN_CAP) break;
      page += 1;
    }
  } catch (error) {
    if (error instanceof SasiApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Erro ao consultar a API SASI." }, { status: 502 });
  }

  const activities = concludedRows.map((row) => {
    const details = detailsByMessageId.get(row.message_id);
    return {
      id: row.message_id,
      description: details?.description ?? "—",
      deadline: details?.deadline ?? null,
      comments: (commentsByMessage.get(row.message_id) ?? []).join(" | "),
      responsible: row.user_name ?? "—",
      updatedAt: row.updated_at,
    };
  });

  return NextResponse.json({ group: { id: group.id, name: group.name }, activities });
}
