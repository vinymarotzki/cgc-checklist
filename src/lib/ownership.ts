/**
 * Regra única de "quem pode alterar o quê", usada pelas rotas de API (que
 * barram de fato) e pelas telas (que só escondem o botão para não oferecer
 * uma ação que vai voltar 403).
 *
 * Só o autor pode renomear/excluir um checklist ou editar/apagar uma
 * observação. Linhas sem autor gravado (o checklist "Checklist existente"
 * criado pela migração em `db.ts`, observações antigas) não têm dono a
 * proteger, então continuam liberadas para qualquer usuário autenticado —
 * bloquear deixaria esses registros impossíveis de manter.
 *
 * Compara como string porque o AUTH_USER_ENDPOINT pode devolver `id`
 * numérico, enquanto o banco guarda sempre texto.
 */
export function isOwner(ownerId: unknown, userId: unknown): boolean {
  if (ownerId === null || ownerId === undefined || String(ownerId).trim() === "") return true;
  return String(ownerId) === String(userId);
}
