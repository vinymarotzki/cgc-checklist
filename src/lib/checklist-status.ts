/**
 * Vocabulário de status do checklist e helpers visuais associados.
 *
 * Extraído de src/app/page.tsx sem alteração de valores, para que outras telas
 * (ex.: Atividades do CGC) reutilizem exatamente a mesma identidade visual em
 * vez de recriar uma paleta paralela.
 */

export type ChecklistStatus =
  | "SEM_STATUS"
  | "NAO_INICIADO"
  | "EM_ANDAMENTO"
  | "CONCLUIDO"
  | "IMPEDIDO";

export interface ChecklistStatusOption {
  value: string;
  label: string;
  color: string;
}

export interface ChecklistStatusStyle {
  bg: string;
  text: string;
  border: string;
}

/** Opções oferecidas no seletor de status do checklist. */
export const STATUS_OPTIONS: ChecklistStatusOption[] = [
  { value: "NAO_INICIADO", label: "Não Iniciado", color: "#b10202" },
  { value: "EM_ANDAMENTO", label: "Em Andamento", color: "#ffe5a0" },
  { value: "CONCLUIDO", label: "Concluído", color: "#11734b" },
];

/** Rótulo legível para qualquer status conhecido, inclusive os não editáveis. */
export const STATUS_LABELS: Record<string, string> = {
  SEM_STATUS: "Sem Status",
  NAO_INICIADO: "Não Iniciado",
  EM_ANDAMENTO: "Em Andamento",
  CONCLUIDO: "Concluído",
  IMPEDIDO: "Impedido",
};

export function getStatusStyle(status: string): ChecklistStatusStyle {
  const map: Record<string, ChecklistStatusStyle> = {
    NAO_INICIADO: { bg: "#b10202", text: "#F8FAFC", border: "#7a0202" },
    EM_ANDAMENTO: { bg: "#ffe5a0", text: "#1F1F1F", border: "#d6c27b" },
    CONCLUIDO: { bg: "#11734b", text: "#F8FAFC", border: "#0e5b3f" },
    IMPEDIDO: { bg: "#b10202", text: "#F8FAFC", border: "#7a0202" },
  };
  return map[status] ?? map["NAO_INICIADO"];
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    NAO_INICIADO: "#b10202",
    EM_ANDAMENTO: "#ffe5a0",
    CONCLUIDO: "#11734b",
    IMPEDIDO: "#b10202",
    SEM_STATUS: "#e8eaed",
  };
  return map[status] ?? "#7A82A0";
}

/**
 * Pílula de status usada nas telas de histórico.
 *
 * Usa o preenchimento sólido de getStatusStyle porque a versão só-contorno
 * deixava CONCLUIDO (#11734b) praticamente ilegível sobre o fundo escuro.
 * SEM_STATUS ganha um cinza neutro em vez de cair no fallback vermelho de
 * getStatusStyle, que faria "Sem Status" parecer "Não Iniciado".
 */
export function getStatusPillStyle(status: string | null | undefined) {
  if (!status || status === "SEM_STATUS") {
    return { background: "#1E2333", color: "#7A82A0", border: "1px solid #2A3045" };
  }
  const style = getStatusStyle(status);
  return { background: style.bg, color: style.text, border: `1px solid ${style.border}` };
}

/** Cor estável derivada do nome do agrupamento (categoria, grupo, etc.). */
export function getCategoryColor(category: string): string {
  const colors = [
    "#3B6EF5", "#8B5CF6", "#06B6D4", "#F59E0B",
    "#10B981", "#EF4444", "#EC4899", "#6366F1",
  ];
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Valida um status vindo de fora (corpo de requisição). Aceita os 5 do
 * vocabulário, inclusive SEM_STATUS e IMPEDIDO, que o seletor não oferece mas
 * existem em dados antigos — recusar só texto desconhecido, sem mudar o que
 * já é gravável hoje.
 */
export function isKnownStatus(value: unknown): value is ChecklistStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STATUS_LABELS, value);
}
