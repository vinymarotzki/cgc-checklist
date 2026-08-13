/**
 * Acesso à tabela `cgc_groups` (Turso/libSQL).
 *
 * O grupo é uma entidade local: define, em nomes de query param da API SASI,
 * qual recorte de mensagens ele representa. Isso mantém a listagem filtrada no
 * servidor da SASI (paginação correta) em vez de filtrar no cliente.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, initDb } from "@/lib/db";
import type { SasiMessagesQuery } from "@/lib/sasi-api/types";
import { getFieldName } from "./field-map";
import type { CgcGroup } from "./types";

/** Campos de filtro persistidos, iguais aos query params de /provider/messages. */
export const CGC_GROUP_FILTER_FIELDS = [
  "category_ids",
  "team_name",
  "channel_ids",
  "app_ids",
] as const;

export type CgcGroupFilterField = (typeof CGC_GROUP_FILTER_FIELDS)[number];

export interface CgcGroupInput {
  name: string;
  category_ids?: string | null;
  team_name?: string | null;
  channel_ids?: string | null;
  app_ids?: string | null;
  data_field_name?: string | null;
  data_field_value?: string | null;
}

/**
 * Canal que entrega as atividades do CGC. Todos os grupos leem dele; o que
 * separa um grupo do outro é o valor do campo dentro da própria mensagem.
 */
export const CGC_DEFAULT_CHANNEL_IDS = "33397";

/** Grupos padrão, criados na primeira leitura para já aparecerem na tela. */
export const CGC_DEFAULT_GROUP_NAMES = ["CGC", "NGOA", "NUPPAE", "CIPA"] as const;

function toNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Normaliza listas de IDs: só dígitos, sem duplicata, separadas por vírgula. */
function toIdList(value: unknown): string | null {
  const text = toNullableText(value);
  if (!text) return null;

  const ids = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));

  return ids.length > 0 ? Array.from(new Set(ids)).join(",") : null;
}

function rowToGroup(row: Record<string, unknown>): CgcGroup {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    category_ids: toNullableText(row.category_ids),
    team_name: toNullableText(row.team_name),
    channel_ids: toNullableText(row.channel_ids),
    app_ids: toNullableText(row.app_ids),
    data_field_name: toNullableText(row.data_field_name),
    data_field_value: toNullableText(row.data_field_value),
    created_by_id: toNullableText(row.created_by_id),
    created_by_name: toNullableText(row.created_by_name),
    created_at: String(row.created_at ?? ""),
  };
}

/**
 * Cria os grupos padrão se ainda não existirem, um a um pelo nome.
 * Idempotente: rodar de novo não duplica nem sobrescreve edições do usuário.
 */
export async function ensureDefaultGroups(): Promise<void> {
  await initDb();
  const db = getDb();
  const groupField = getFieldName("group");

  for (const name of CGC_DEFAULT_GROUP_NAMES) {
    const existing = await db.execute({
      sql: "SELECT id, data_field_name, data_field_value FROM cgc_groups WHERE name = ? COLLATE NOCASE LIMIT 1",
      args: [name],
    });

    if (existing.rows.length > 0) {
      // Backfill dos grupos criados antes de o nome do campo ser conhecido.
      // Só toca em quem ainda não tem campo definido e cujo valor é o próprio
      // nome do grupo — assim uma edição do usuário nunca é sobrescrita.
      const row = existing.rows[0] as unknown as Record<string, unknown>;
      if (!row.data_field_name && String(row.data_field_value ?? "") === name) {
        await db.execute({
          sql: "UPDATE cgc_groups SET data_field_name = ? WHERE id = ?",
          args: [groupField, String(row.id)],
        });
      }
      continue;
    }

    await db.execute({
      sql: `INSERT INTO cgc_groups
              (id, name, category_ids, team_name, channel_ids, app_ids,
               data_field_name, data_field_value, created_by_id, created_by_name, created_at)
            VALUES (?, ?, NULL, NULL, ?, NULL, ?, ?, NULL, ?, ?)`,
      args: [
        uuidv4(),
        name,
        CGC_DEFAULT_CHANNEL_IDS,
        groupField,
        name,
        "Sistema",
        new Date().toISOString(),
      ],
    });
  }
}

export async function listGroups(): Promise<CgcGroup[]> {
  await ensureDefaultGroups();
  const db = getDb();
  const result = await db.execute(
    "SELECT * FROM cgc_groups ORDER BY name COLLATE NOCASE ASC"
  );
  return result.rows.map((row) => rowToGroup(row as unknown as Record<string, unknown>));
}

export async function getGroup(id: string): Promise<CgcGroup | null> {
  await initDb();
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT * FROM cgc_groups WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  return row ? rowToGroup(row as unknown as Record<string, unknown>) : null;
}

export async function createGroup(
  input: CgcGroupInput,
  author: { id: string; name: string }
): Promise<CgcGroup> {
  await initDb();
  const db = getDb();

  const group: CgcGroup = {
    id: uuidv4(),
    name: input.name.trim(),
    category_ids: toIdList(input.category_ids),
    team_name: toNullableText(input.team_name),
    channel_ids: toIdList(input.channel_ids),
    app_ids: toIdList(input.app_ids),
    data_field_name: toNullableText(input.data_field_name),
    data_field_value: toNullableText(input.data_field_value),
    created_by_id: author.id,
    created_by_name: author.name,
    created_at: new Date().toISOString(),
  };

  await db.execute({
    sql: `INSERT INTO cgc_groups
            (id, name, category_ids, team_name, channel_ids, app_ids,
             data_field_name, data_field_value, created_by_id, created_by_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      group.id,
      group.name,
      group.category_ids,
      group.team_name,
      group.channel_ids,
      group.app_ids,
      group.data_field_name,
      group.data_field_value,
      group.created_by_id,
      group.created_by_name,
      group.created_at,
    ],
  });

  return group;
}

export async function updateGroup(id: string, input: CgcGroupInput): Promise<void> {
  await initDb();
  const db = getDb();

  await db.execute({
    sql: `UPDATE cgc_groups
          SET name = ?, category_ids = ?, team_name = ?, channel_ids = ?, app_ids = ?,
              data_field_name = ?, data_field_value = ?
          WHERE id = ?`,
    args: [
      input.name.trim(),
      toIdList(input.category_ids),
      toNullableText(input.team_name),
      toIdList(input.channel_ids),
      toIdList(input.app_ids),
      toNullableText(input.data_field_name),
      toNullableText(input.data_field_value),
      id,
    ],
  });
}

export async function deleteGroup(id: string): Promise<void> {
  await initDb();
  const db = getDb();
  await db.execute({ sql: "DELETE FROM cgc_groups WHERE id = ?", args: [id] });
}

/**
 * Traduz o grupo em query params de GET /provider/messages.
 * Um grupo sem nenhum filtro retorna as atividades do provider inteiro.
 */
export function groupToMessagesQuery(group: CgcGroup): SasiMessagesQuery {
  return {
    category_ids: group.category_ids ?? undefined,
    team_name: group.team_name ?? undefined,
    channel_ids: group.channel_ids ?? undefined,
    app_ids: group.app_ids ?? undefined,
  };
}

/** Regra de roteamento por campo da mensagem, quando o grupo tiver uma. */
export function groupToFieldRule(group: CgcGroup) {
  if (!group.data_field_value) return null;
  return { name: group.data_field_name, value: group.data_field_value };
}

/**
 * Um grupo sem nenhum filtro e sem regra de campo listaria tudo do provider.
 * A tela trata esse caso como "não configurado" em vez de mostrar dado errado.
 */
export function groupIsUnconfigured(group: CgcGroup): boolean {
  return (
    !group.category_ids &&
    !group.team_name &&
    !group.channel_ids &&
    !group.app_ids &&
    !group.data_field_value
  );
}
