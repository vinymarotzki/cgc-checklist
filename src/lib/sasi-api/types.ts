/**
 * Tipos da API SASI (Bone API) — https://api.bone.sasi.io
 *
 * Espelham o contrato OpenAPI publicado em https://api.bone.sasi.io/api-json
 * (documentação navegável em https://api.bone.sasi.io/api/provider):
 * schemas ProviderMessageComposed, StatusEntity, CategoryEntity,
 * ProviderChannelEntity e ProfileEntity.
 *
 * Todos os campos são declarados como opcionais de propósito. A resposta vem de
 * um serviço externo e o mapeamento nunca deve assumir que um campo chegou.
 */

/** StatusEntity.system_tag — enum fechado no contrato da API. */
export type SasiStatusSystemTag =
  | "UNASSIGNED"
  | "ASSIGNED"
  | "CLOSED"
  | "READ"
  | "CUSTOM";

/** StatusEntity: status configurável pelo provider. */
export interface SasiStatusEntity {
  id?: number;
  name?: string;
  color?: string;
  icon?: string;
  active?: boolean;
  /** Tipado como string além do enum: a API pode ganhar tags novas. */
  system_tag?: SasiStatusSystemTag | string;
  provider_id?: number;
  created_at?: string;
}

/** CategoryEntity: categoria de classificação, vinculada a um department_id. */
export interface SasiCategoryEntity {
  id?: number;
  name?: string;
  parent_id?: number | null;
  department_id?: number;
  provider_id?: number;
  created_at?: string;
  updated_at?: string;
}

/** ProviderChannelEntity: canal pelo qual a mensagem chegou. */
export interface SasiProviderChannelEntity {
  channel_id?: number;
  provider_id?: number;
  name?: string | null;
  nickname?: string | null;
  type?: string;
  category_id?: number | null;
  app_id?: number | null;
  active?: boolean;
  categorization?: string;
}

/** ProfileEntity: quem enviou a mensagem. */
export interface SasiProfileEntity {
  id?: number;
  name?: string;
  client_id?: number | null;
  provider_id?: number;
  created_at?: string;
  updated_at?: string | null;
  raw?: Record<string, unknown> | null;
}

/**
 * Item de `data_fields[]` (e de `raw.dataFields[]`): campo do formulário
 * dinâmico do app SASI. O conjunto de campos varia por app — por isso o prazo
 * é procurado aqui em vez de existir como coluna fixa.
 */
export interface SasiDataField {
  name?: string;
  title?: string;
  type?: string;
  fieldType?: string | null;
  dataType?: string | null;
  tag?: string | null;
  visible?: boolean | null;
  value?: unknown;
  formattedValue?: string | string[];
  comments?: string | null;
  attachments?: unknown[] | null;
}

/** Payload original da mensagem SASI (`ProviderMessageComposed.raw`). */
export interface SasiMessageRaw {
  id?: number;
  uuid?: string;
  text?: string;
  test?: boolean;
  anonymous?: boolean;
  generatedAt?: string;
  lat?: number;
  lng?: number;
  app?: { id?: number; name?: string; tag?: string | null } | null;
  team?: { id?: number; name?: string; tag?: string | null; timeZone?: string } | null;
  client?: { id?: number; name?: string; tag?: string | null } | null;
  channel?: { id?: number; name?: string; channelType?: string; mode?: string } | null;
  project?: { id?: number; name?: string; tag?: string | null } | null;
  profile?: Record<string, unknown> | null;
  dataFields?: SasiDataField[];
  attachments?: unknown[];
  nearLocation?: unknown;
  [key: string]: unknown;
}

/** ProviderMessageComposed: item retornado por GET /provider/messages. */
export interface SasiProviderMessage {
  id?: number;
  provider_id?: number;
  created_at?: string;
  generated_at?: string;
  updated_at?: string | null;
  last_activity_at?: string;
  classified_at?: string | null;
  classified_by?: unknown;
  channel_id?: number;
  category_id?: number | null;
  status_id?: number | null;
  app_id?: number;
  profile_id?: number | null;
  /** Declarado como object nullable no schema; na prática chega como array. */
  data_fields?: SasiDataField[] | Record<string, unknown> | null;
  raw?: SasiMessageRaw | null;
  status?: SasiStatusEntity | null;
  category?: SasiCategoryEntity | null;
  profile?: SasiProfileEntity | null;
  provider_channel?: SasiProviderChannelEntity | null;
}

/**
 * Query params aceitos por GET /provider/messages e GET /provider/messages/count.
 * Nomes idênticos aos do contrato — nenhum parâmetro adicional é suportado.
 */
export interface SasiMessagesQuery {
  /** Página, base 1. Default da API: 1. */
  page?: number;
  /** Itens por página. Default da API: 10. Máximo: 100. */
  limit?: number;
  /** Busca textual em texto da mensagem, nome do perfil e categoria. */
  search?: string;
  /** IDs de categoria, separados por vírgula. */
  category_ids?: string;
  /** IDs de app, separados por vírgula. */
  app_ids?: string;
  /** IDs de canal, separados por vírgula. */
  channel_ids?: string;
  /** Nome do time (raw.team.name). */
  team_name?: string;
  /** Nome do contato/perfil (raw.profile.name). */
  contact_name?: string;
  /** IDs de status, separados por vírgula. */
  status_ids?: string;
  /** Data no formato YYYY-MM-DD. */
  date?: string;
  exclude_status_ids?: string;
  exclude_channel_ids?: string;
  exclude_category_ids?: string;
  exclude_app_ids?: string;
}
