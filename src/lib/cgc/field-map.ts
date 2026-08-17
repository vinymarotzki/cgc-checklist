/**
 * Nomes dos campos do formulário que alimentam as Atividades do CGC.
 *
 * Confirmados contra o canal 33397 ("Envio de Atividades", app "CGC - Gestor"):
 *
 *   selecione_time    "Selecione o Time*"   dropdown  → grupo
 *   prazo_de_entrega  "Prazo de Entrega*"   date      → prazo
 *   descreva          "Descreva*"           text      → descrição
 *
 * São sobrescrevíveis por variável de ambiente para que uma renomeação no app
 * não exija novo deploy. O mapper ainda tem heurística de reserva, então perder
 * o nome exato degrada a leitura em vez de zerar a tela.
 */

export type CgcFieldRole = "group" | "deadline" | "description";

const DEFAULT_FIELD_NAMES: Record<CgcFieldRole, string> = {
  group: "selecione_time",
  deadline: "prazo_de_entrega",
  description: "descreva",
};

const ENV_KEYS: Record<CgcFieldRole, string> = {
  group: "SASI_CGC_FIELD_GROUP",
  deadline: "SASI_CGC_FIELD_DEADLINE",
  description: "SASI_CGC_FIELD_DESCRIPTION",
};

export function getFieldName(role: CgcFieldRole): string {
  const override = process.env[ENV_KEYS[role]]?.trim();
  return override || DEFAULT_FIELD_NAMES[role];
}

/**
 * Campo "Prioridades*" do formulário SASI. Prioridade deixou de ser um recorte
 * da atividade — sem isso aqui, o campo cru vazaria pra lista genérica de
 * "Ver detalhes" assim que parasse de ser tratado como coluna fixa.
 */
const LEGACY_PRIORITY_FIELD_NAME =
  process.env.SASI_CGC_FIELD_PRIORITY?.trim() || "prioridades";

/** Nomes consumidos pelas colunas fixas — não devem repetir na lista de campos. */
export function getConsumedFieldNames(): string[] {
  return [
    ...(Object.keys(DEFAULT_FIELD_NAMES) as CgcFieldRole[]).map(getFieldName),
    LEGACY_PRIORITY_FIELD_NAME,
  ];
}
