/**
 * Tradução de ProviderMessageComposed (API SASI) para CgcActivity.
 *
 * Regra geral: nada aqui pode lançar por causa de dado faltando ou inesperado.
 * Campo ausente vira null/valor neutro e a interface mostra o estado vazio.
 */

import type { ChecklistStatus } from "@/lib/checklist-status";
import { STATUS_LABELS } from "@/lib/checklist-status";
import type {
  SasiDataField,
  SasiProviderMessage,
} from "@/lib/sasi-api/types";
import { getConsumedFieldNames, getFieldName } from "./field-map";
import { CGC_DEFAULT_STATUS } from "./status-store";
import type {
  CgcActivity,
  CgcActivityField,
  CgcDeadline,
  CgcSasiStatus,
} from "./types";

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Converte a chave system_tag da API para o vocabulário de status do checklist.
 * Não cria estrutura de status nova: reusa NAO_INICIADO / EM_ANDAMENTO / CONCLUIDO.
 */
export function mapSystemTagToChecklistStatus(systemTag: string | null): ChecklistStatus {
  switch (systemTag) {
    case "UNASSIGNED":
      return "NAO_INICIADO";
    case "ASSIGNED":
    case "READ":
    case "CUSTOM":
      return "EM_ANDAMENTO";
    case "CLOSED":
      return "CONCLUIDO";
    default:
      // Status presente mas com tag desconhecida ainda significa "em tratamento".
      return systemTag ? "EM_ANDAMENTO" : "SEM_STATUS";
  }
}

function mapSasiStatus(message: SasiProviderMessage): CgcSasiStatus | null {
  const status = isRecord(message.status) ? message.status : null;
  if (!status) return null;

  const systemTag = toText(status.system_tag);
  const key = mapSystemTagToChecklistStatus(systemTag);

  return {
    key,
    label: toText(status.name) ?? STATUS_LABELS[key] ?? key,
    color: toText(status.color),
    systemTag,
    id: typeof status.id === "number" ? status.id : null,
  };
}

/** Localiza um campo pelo nome técnico, tag ou título. */
function findField(fields: SasiDataField[], wantedName: string): SasiDataField | null {
  const wanted = normalizeForMatch(wantedName);
  if (!wanted) return null;

  for (const field of fields) {
    const candidates = [field.name, field.tag, field.title]
      .map(toText)
      .filter((text): text is string => Boolean(text));
    if (candidates.some((candidate) => normalizeForMatch(candidate) === wanted)) {
      return field;
    }
  }

  return null;
}

/**
 * Descrição da atividade: campo `descreva` do formulário.
 * `raw.text` chega vazio nesse canal, então serve apenas como reserva.
 */
function mapDescription(
  message: SasiProviderMessage,
  fields: SasiDataField[]
): string | null {
  const field = findField(fields, getFieldName("description"));
  return (field ? pickFormattedValue(field) : null) ?? toText(message.raw?.text);
}

/** `data_fields` chega como array; aceita também objeto indexado e raw.dataFields. */
function toDataFields(message: SasiProviderMessage): SasiDataField[] {
  const candidates: unknown[] = [message.data_fields, message.raw?.dataFields];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord) as SasiDataField[];
    }
    if (isRecord(candidate)) {
      const values = Object.values(candidate).filter(isRecord);
      if (values.length > 0) return values as SasiDataField[];
    }
  }

  return [];
}

/**
 * Todos os campos preenchíveis associados à mensagem: os do formulário
 * (`data_fields` / `raw.dataFields`) e os do perfil de quem enviou
 * (`raw.profile.profileFields`). O campo que identifica o grupo de destino pode
 * estar em qualquer um dos dois.
 */
export function collectAllFields(message: SasiProviderMessage): SasiDataField[] {
  const fields = [...toDataFields(message)];

  const profile = message.raw?.profile;
  if (isRecord(profile) && Array.isArray(profile.profileFields)) {
    fields.push(...(profile.profileFields.filter(isRecord) as SasiDataField[]));
  }

  return fields;
}

function normalizeForMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Junta `formattedValue` (string ou lista) num texto único. */
function joinTexts(source: unknown): string | null {
  if (Array.isArray(source)) {
    const parts = source.map(toText).filter((text): text is string => Boolean(text));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return toText(source);
}

/**
 * Conteúdo legível de um campo.
 *
 * `formattedValue` tem prioridade: é o texto já resolvido pela API. Vários
 * campos chegam com `value: null` e só o `formattedValue` preenchido (é o caso
 * de dropdowns encadeados, listas e ratings), então ler `value` primeiro
 * perderia a informação.
 */
export function pickFormattedValue(field: SasiDataField): string | null {
  return joinTexts(field.formattedValue) ?? joinTexts(field.value);
}

/** Todos os textos que um campo carrega, entre `formattedValue` e `value`. */
function fieldTexts(field: SasiDataField): string[] {
  const texts: string[] = [];

  for (const source of [field.formattedValue, field.value]) {
    if (Array.isArray(source)) {
      for (const item of source) {
        const text = toText(item);
        if (text) texts.push(text);
      }
    } else {
      const text = toText(source);
      if (text) texts.push(text);
    }
  }

  return texts;
}

export interface FieldRule {
  /** Nome/tag do campo. Em branco, procura em todos os campos. */
  name?: string | null;
  /** Valor procurado, comparado sem acento e sem diferenciar maiúsculas. */
  value: string;
}

/**
 * Diz se a mensagem pertence ao grupo, comparando o valor procurado com o
 * conteúdo dos campos. Sem `name`, qualquer campo serve — o que permite rotear
 * sem conhecer de antemão o nome técnico do campo no app.
 */
export function messageMatchesFieldRule(
  message: SasiProviderMessage,
  rule: FieldRule
): boolean {
  const wanted = normalizeForMatch(rule.value);
  if (!wanted) return true;

  const wantedName = rule.name ? normalizeForMatch(rule.name) : null;

  for (const field of collectAllFields(message)) {
    if (wantedName) {
      const name = toText(field.name);
      const tag = toText(field.tag);
      const title = toText(field.title);
      const matchesName = [name, tag, title].some(
        (candidate) => candidate && normalizeForMatch(candidate) === wantedName
      );
      if (!matchesName) continue;
    }

    if (fieldTexts(field).some((text) => normalizeForMatch(text) === wanted)) {
      return true;
    }
  }

  return false;
}

/** Tipos de campo do formulário que representam data/hora. */
const DATE_FIELD_TYPES = new Set([
  "date",
  "datetime",
  "date_time",
  "datetime_local",
  "datepicker",
  "date_picker",
  "time",
  "timestamp",
]);

function isDateField(field: SasiDataField): boolean {
  const type = toText(field.type)?.toLowerCase();
  if (type && DATE_FIELD_TYPES.has(type)) return true;

  const dataType = toText(field.dataType)?.toLowerCase();
  if (dataType && /date|time/.test(dataType)) return true;

  const fieldType = toText(field.fieldType)?.toLowerCase();
  return Boolean(fieldType && DATE_FIELD_TYPES.has(fieldType));
}

function toLocalIso(
  year: string,
  month: string,
  day: string,
  hour = "00",
  minute = "00",
  second = "00"
): string | null {
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Aceita o formato brasileiro DD/MM/AAAA e o ISO, ambos com hora opcional.
 *
 * Datas sem hora são interpretadas no fuso local. `new Date("2026-09-30")`
 * seria lido como meia-noite UTC e, exibido em UTC-4, apareceria como 29/09 —
 * um dia a menos que o prazo real.
 */
function parseDate(value: string): string | null {
  const brazilian = value.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (brazilian) {
    const [, day, month, year, hour, minute, second] = brazilian;
    return toLocalIso(year, month, day, hour, minute, second);
  }

  const isoDateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const [, year, month, day] = isoDateOnly;
    return toLocalIso(year, month, day);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toDeadline(field: SasiDataField): CgcDeadline | null {
  const label = pickFormattedValue(field);
  if (!label) return null;

  // Para converter em data, o `value` cru costuma ser mais confiável que o
  // texto formatado; se não houver, o próprio formatado é parseado.
  const parseable = joinTexts(field.value) ?? label;

  return {
    fieldTitle: toText(field.title),
    fieldName: toText(field.name),
    label,
    iso: parseDate(parseable) ?? parseDate(label),
  };
}

/**
 * Prazo da atividade: campo `prazo_de_entrega`. Sem ele, cai no primeiro campo
 * do tipo data que tenha valor.
 */
export function extractDeadline(message: SasiProviderMessage): CgcDeadline | null {
  const fields = collectAllFields(message);

  const named = findField(fields, getFieldName("deadline"));
  if (named) {
    const deadline = toDeadline(named);
    if (deadline) return deadline;
  }

  for (const field of fields) {
    if (!isDateField(field)) continue;
    const deadline = toDeadline(field);
    if (deadline) return deadline;
  }

  return null;
}

/**
 * Campos extras da mensagem, para exibição.
 *
 * Só campos do formulário: `profileFields` fica de fora de propósito, porque
 * carrega dados pessoais de quem enviou (telefone, e-mail, data de nascimento)
 * que não fazem parte da atividade. O nome do remetente já é exibido à parte.
 *
 * Só entram campos visíveis com `formattedValue` preenchido — é onde a API põe
 * o conteúdo já resolvido. Os campos que já viram coluna fixa (grupo, prazo,
 * descrição) são excluídos para não aparecerem duas vezes.
 */
export function extractFields(message: SasiProviderMessage): CgcActivityField[] {
  const fields: CgcActivityField[] = [];
  const seen = new Set(getConsumedFieldNames().map(normalizeForMatch));

  for (const field of toDataFields(message)) {
    if (field.visible === false) continue;

    const value = pickFormattedValue(field);
    if (!value) continue;

    const name = toText(field.name);
    const key = normalizeForMatch(name ?? value);
    if (seen.has(key)) continue;
    seen.add(key);

    fields.push({ name, title: toText(field.title) ?? name, value });
  }

  return fields;
}

export interface MapMessageContext {
  /** Nome do grupo local selecionado, usado como grupo responsável. */
  groupName?: string | null;
}

/** Converte uma mensagem da API em atividade do CGC. */
export function mapMessageToActivity(
  message: SasiProviderMessage,
  context: MapMessageContext = {}
): CgcActivity {
  const raw = isRecord(message.raw) ? message.raw : null;
  const messageId = typeof message.id === "number" ? message.id : null;
  const allFields = collectAllFields(message);
  const description = mapDescription(message, allFields);
  const fields = extractFields(message);

  const teamName = isRecord(raw?.team) ? toText(raw.team.name) : null;
  const categoryName = isRecord(message.category) ? toText(message.category.name) : null;
  const channel = isRecord(message.provider_channel)
    ? toText(message.provider_channel.nickname) ?? toText(message.provider_channel.name)
    : null;

  return {
    id: messageId !== null ? String(messageId) : toText(raw?.uuid) ?? crypto.randomUUID(),
    messageId,
    group:
      toText(context.groupName) ??
      pickFormattedValue(findField(allFields, getFieldName("group")) ?? {}) ??
      teamName ??
      categoryName,
    deadline: extractDeadline(message),
    description: description ?? "Atividade sem descrição",
    fields,
    // Toda atividade nasce como Não Iniciado; a rota sobrepõe com o status
    // registrado em cgc_activity_status, quando houver.
    status: CGC_DEFAULT_STATUS,
    sasiStatus: mapSasiStatus(message),
    category: categoryName,
    channel,
    contact: isRecord(message.profile) ? toText(message.profile.name) : null,
    createdAt: toText(message.created_at) ?? toText(message.generated_at),
    lastActivityAt: toText(message.last_activity_at),
    // Só é incompleta se não houver nem texto nem campo preenchido: quando os
    // campos trazem conteúdo, a atividade é legível mesmo sem raw.text.
    incomplete: description === null && fields.length === 0,
  };
}

export interface MapMessagesResult {
  activities: CgcActivity[];
  /** Itens ignorados por não terem forma de objeto. */
  skipped: number;
}

/** Mapeia a lista inteira, descartando itens irrecuperáveis em vez de falhar. */
export function mapMessagesToActivities(
  messages: unknown[],
  context: MapMessageContext = {}
): MapMessagesResult {
  const activities: CgcActivity[] = [];
  let skipped = 0;

  for (const message of messages) {
    if (!isRecord(message)) {
      skipped += 1;
      continue;
    }

    try {
      activities.push(mapMessageToActivity(message as SasiProviderMessage, context));
    } catch {
      skipped += 1;
    }
  }

  return { activities, skipped };
}
