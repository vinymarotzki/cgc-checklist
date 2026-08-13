/**
 * Atividades do CGC.
 *
 * Fluxo: auth local → grupo (Turso) → GET /provider/messages (API SASI) →
 * roteamento por campo → mapeamento → resposta tipada. O token do usuário é
 * repassado como Bearer a partir daqui, então nunca sai do servidor e não há
 * chamada cross-origin.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  getGroup,
  groupIsUnconfigured,
  groupToFieldRule,
  groupToMessagesQuery,
} from "@/lib/cgc/groups";
import { mapMessagesToActivities, messageMatchesFieldRule } from "@/lib/cgc/mapper";
import { readSnapshot, recordHistory } from "@/lib/cgc/history";
import {
  backfillGroup,
  getStatus,
  getStatuses,
  isAllowedStatus,
  setStatus,
} from "@/lib/cgc/status-store";
import type { CgcActivitiesResponse, CgcActivity } from "@/lib/cgc/types";
import { SasiApiError, resolveSasiToken } from "@/lib/sasi-api/client";
import {
  SASI_MESSAGES_MAX_LIMIT,
  fetchProviderMessages,
  fetchProviderMessagesCount,
} from "@/lib/sasi-api/messages";
import type { SasiMessagesQuery, SasiProviderMessage } from "@/lib/sasi-api/types";

const DEFAULT_LIMIT = 50;

/**
 * Teto de mensagens lidas da API quando o grupo roteia por campo. A API não
 * filtra por conteúdo de formulário, então é preciso varrer e filtrar aqui —
 * o teto evita uma varredura sem fim em canais muito grandes.
 */
const SCAN_CAP = Number(process.env.SASI_CGC_SCAN_CAP) > 0
  ? Number(process.env.SASI_CGC_SCAN_CAP)
  : 500;

/** HTTP de saída para cada tipo de falha da API SASI. */
function statusForError(error: SasiApiError): number {
  switch (error.kind) {
    case "auth":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "timeout":
      return 504;
    case "network":
      return 502;
    case "parse":
      return 502;
    default:
      return error.status && error.status >= 400 ? error.status : 502;
  }
}

function toPositiveInt(value: string | null, fallback: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  const truncated = Math.trunc(parsed);
  return max ? Math.min(truncated, max) : truncated;
}

function optionalParam(value: string | null): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/**
 * Sobrepõe o status padrão pelo que está registrado localmente.
 * Uma falha aqui não pode derrubar a listagem: sem o registro, todas as
 * atividades simplesmente aparecem como Não Iniciado.
 */
async function applyLocalStatuses(
  activities: CgcActivity[],
  groupId: string
): Promise<CgcActivity[]> {
  if (activities.length === 0) return activities;

  try {
    const ids = activities.map((activity) => activity.id);
    await backfillGroup(ids, groupId);
    const statuses = await getStatuses(ids);
    return activities.map((activity) => {
      const status = statuses.get(activity.id);
      return status ? { ...activity, status } : activity;
    });
  } catch {
    return activities;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const params = req.nextUrl.searchParams;
  const groupId = params.get("group")?.trim();

  if (!groupId) {
    return NextResponse.json({ error: "Selecione um grupo para listar as atividades." }, { status: 400 });
  }

  // `requireAuth` já garantiu o token da URL; SASI_API_TOKEN continua como
  // alternativa de servidor para ambientes que usam token próprio.
  const sasiToken = resolveSasiToken(auth.token);
  if (!sasiToken) {
    return NextResponse.json(
      {
        error: "Token da API SASI não informado. Acesse com ?sasi-token=SEU_TOKEN para consultar as atividades do CGC.",
        kind: "auth",
      },
      { status: 401 }
    );
  }

  let group;
  try {
    group = await getGroup(groupId);
  } catch {
    return NextResponse.json({ error: "Falha ao carregar o grupo selecionado." }, { status: 500 });
  }

  if (!group) {
    return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });
  }

  const page = toPositiveInt(params.get("page"), 1);
  const limit = toPositiveInt(params.get("limit"), DEFAULT_LIMIT, SASI_MESSAGES_MAX_LIMIT);
  const user = { id: String(auth.user.id), name: String(auth.user.name) };

  // Grupo sem nenhum filtro listaria o provider inteiro: melhor não consultar.
  if (groupIsUnconfigured(group)) {
    const body: CgcActivitiesResponse = {
      activities: [], group, page, limit, total: 0, hasMore: false,
      skipped: 0, scanned: 0, truncated: false, unconfigured: true, user,
    };
    return NextResponse.json(body);
  }

  // Filtros do grupo + filtros pontuais da tela. Só nomes do contrato da API.
  const baseQuery: SasiMessagesQuery = {
    ...groupToMessagesQuery(group),
    search: optionalParam(params.get("search")),
    status_ids: optionalParam(params.get("status_ids")),
    date: optionalParam(params.get("date")),
  };

  const fieldRule = groupToFieldRule(group);

  try {
    if (!fieldRule) {
      // Sem roteamento por campo: a API pagina e conta sozinha.
      const query = { ...baseQuery, page, limit };
      const messages = await fetchProviderMessages(query, { token: sasiToken });
      const total = await fetchProviderMessagesCount(query, { token: sasiToken }).catch(() => null);
      const mapped = mapMessagesToActivities(messages, { groupName: group.name });
      const { skipped } = mapped;
      const activities = await applyLocalStatuses(mapped.activities, group.id);

      const body: CgcActivitiesResponse = {
        activities, group, page, limit, total,
        hasMore: total !== null ? page * limit < total : messages.length >= limit,
        skipped, scanned: messages.length, truncated: false, unconfigured: false, user,
      };
      return NextResponse.json(body);
    }

    // Com roteamento por campo: varre páginas da API até o teto, filtra e
    // pagina localmente — só assim a contagem e as páginas ficam corretas.
    const matched: SasiProviderMessage[] = [];
    let scanned = 0;
    let truncated = false;
    let apiPage = 1;

    while (scanned < SCAN_CAP) {
      const batch = await fetchProviderMessages(
        { ...baseQuery, page: apiPage, limit: SASI_MESSAGES_MAX_LIMIT },
        { token: sasiToken }
      );

      scanned += batch.length;
      for (const message of batch) {
        if (messageMatchesFieldRule(message, fieldRule)) matched.push(message);
      }

      if (batch.length < SASI_MESSAGES_MAX_LIMIT) break;
      if (scanned >= SCAN_CAP) {
        truncated = true;
        break;
      }
      apiPage += 1;
    }

    const start = (page - 1) * limit;
    const slice = matched.slice(start, start + limit);
    const mapped = mapMessagesToActivities(slice, { groupName: group.name });
    const { skipped } = mapped;
    const activities = await applyLocalStatuses(mapped.activities, group.id);

    const body: CgcActivitiesResponse = {
      activities,
      group,
      page,
      limit,
      total: truncated ? null : matched.length,
      hasMore: start + limit < matched.length,
      skipped,
      scanned,
      truncated,
      unconfigured: false,
      user,
    };
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof SasiApiError) {
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        { status: statusForError(error) }
      );
    }
    return NextResponse.json(
      { error: "Erro inesperado ao consultar as atividades do CGC.", kind: "http" },
      { status: 500 }
    );
  }
}

/**
 * Troca o status de uma atividade.
 *
 * Grava só na tabela local: o token de provider da API SASI tem escopo
 * READ_MESSAGES e não pode alterar o status lá.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null);
  const source = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const status = source.status;

  if (!id) {
    return NextResponse.json({ error: "ID da atividade obrigatório" }, { status: 400 });
  }

  if (!isAllowedStatus(status)) {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }

  const user = { id: String(auth.user.id), name: String(auth.user.name) };
  const snapshot = readSnapshot(source);

  try {
    const previous = await getStatus(id);
    await setStatus(id, status, user, snapshot.group_id);

    // Só registra quando algo mudou de fato — reenvio do mesmo status não
    // deve encher o histórico.
    if (previous !== status) {
      await recordHistory({
        ...snapshot,
        message_id: id,
        old_status: previous,
        new_status: status,
        user,
      });
    }

    return NextResponse.json({ success: true, id, status });
  } catch {
    return NextResponse.json({ error: "Falha ao salvar o status." }, { status: 500 });
  }
}
