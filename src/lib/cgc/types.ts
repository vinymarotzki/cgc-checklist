/**
 * Modelo interno das Atividades do CGC.
 *
 * Deliberadamente independente dos tipos brutos da API SASI: a página consome
 * só este formato, então mudanças no payload externo ficam contidas no mapper.
 */

import type { ChecklistStatus } from "@/lib/checklist-status";

/**
 * Nível de prioridade, usado para cor e ordenação.
 *
 * OUTRA cobre um valor preenchido que não se encaixa na escala conhecida — o
 * rótulo original continua sendo exibido em vez de ser descartado.
 */
export type CgcPriorityLevel = "ALTA" | "MEDIA" | "BAIXA" | "OUTRA" | "SEM_PRIORIDADE";

/**
 * Prioridade da atividade.
 *
 * Vem do campo `prioridades` do formulário (Alta/Média/Baixa). O `raw.priority`
 * do contrato é apenas um booleano de destaque e serve só como reserva.
 */
export interface CgcPriority {
  level: CgcPriorityLevel;
  /** Texto como veio da API, ex.: "Alta". */
  label: string;
}

/**
 * Prazo da atividade.
 *
 * Não existe campo de prazo no contrato da API. O valor é extraído do primeiro
 * campo de formulário (`data_fields[]`) cujo tipo indica data.
 */
export interface CgcDeadline {
  /** Título do campo de origem, para o usuário conferir de onde veio. */
  fieldTitle: string | null;
  /** Nome técnico do campo de origem. */
  fieldName: string | null;
  /** Texto já formatado pela API, quando disponível. */
  label: string;
  /** Data em ISO, quando o valor foi parseável. */
  iso: string | null;
}

/**
 * Campo preenchido da mensagem, já resolvido.
 * O valor vem do `formattedValue` da API — é o texto pronto para exibição.
 */
export interface CgcActivityField {
  /** Nome técnico do campo no app. */
  name: string | null;
  /** Rótulo exibido; cai para o nome técnico quando não há título. */
  title: string | null;
  value: string;
}

/**
 * Status como está na API SASI. Informativo apenas: o status editável da
 * atividade é acompanhado localmente, no vocabulário do checklist.
 */
export interface CgcSasiStatus {
  /** Equivalente no vocabulário do checklist. */
  key: ChecklistStatus;
  /** Nome do status configurado no provider, ex.: "Assigned". */
  label: string;
  /** Cor definida no provider, quando houver. */
  color: string | null;
  /** system_tag original (UNASSIGNED, ASSIGNED, CLOSED, READ, CUSTOM). */
  systemTag: string | null;
  id: number | null;
}

/** Atividade do CGC já normalizada para a interface. */
export interface CgcActivity {
  /** Chave de render. Deriva do id da mensagem quando existe. */
  id: string;
  messageId: number | null;
  /** Grupo responsável (grupo local selecionado, com fallback para o time da API). */
  group: string | null;
  priority: CgcPriority;
  deadline: CgcDeadline | null;
  description: string;
  /** Campos preenchidos da mensagem, lidos do `formattedValue`. */
  fields: CgcActivityField[];
  /**
   * Status editável, no mesmo vocabulário do checklist. Vem da tabela local
   * `cgc_activity_status` e começa em NAO_INICIADO.
   */
  status: string;
  /** Status na API SASI, para referência. Não é editável. */
  sasiStatus: CgcSasiStatus | null;
  /** Categoria de classificação no provider. */
  category: string | null;
  channel: string | null;
  contact: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
  /** true quando faltou a descrição — a interface sinaliza dado incompleto. */
  incomplete: boolean;
}

/** Grupo do CGC: entidade local que define o recorte de atividades da API. */
export interface CgcGroup {
  id: string;
  name: string;
  /** Filtros repassados literalmente a GET /provider/messages. */
  category_ids: string | null;
  team_name: string | null;
  channel_ids: string | null;
  app_ids: string | null;
  /**
   * Roteamento por campo da mensagem. A API não filtra por conteúdo de
   * formulário, então isso é aplicado no servidor, depois da consulta.
   *
   * `data_field_value` é o valor procurado (ex.: "NGOA"). `data_field_name`
   * restringe a busca a um campo específico; em branco, procura em todos os
   * campos do formulário e do perfil.
   */
  data_field_name: string | null;
  data_field_value: string | null;
  created_by_id: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** Resposta de GET /api/cgc/activities. */
export interface CgcActivitiesResponse {
  activities: CgcActivity[];
  group: CgcGroup | null;
  page: number;
  limit: number;
  /** Total de atividades do grupo, ou null se indisponível. */
  total: number | null;
  hasMore: boolean;
  /** Quantidade de itens descartados por não terem forma de mensagem. */
  skipped: number;
  /** Mensagens lidas da API antes do roteamento por campo. */
  scanned: number;
  /** true quando o teto de varredura foi atingido e podem faltar atividades. */
  truncated: boolean;
  /** true quando o grupo ainda não tem nenhum filtro configurado. */
  unconfigured: boolean;
  user: { id: string; name: string } | null;
}
