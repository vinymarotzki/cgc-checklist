/**
 * Leitura do token de acesso na URL — fonte única para cliente e servidor.
 *
 * Regra única: o token só é aceito no parâmetro `sasi-token`. Qualquer outra
 * forma — parâmetro ausente, nome diferente (o antigo `token`), valor vazio ou
 * só com espaços — é tratada como "sem acesso". Não existe fallback de nome de
 * parâmetro nem bypass por host: localhost segue exatamente a mesma regra da
 * produção, para que o comportamento testado em desenvolvimento seja o mesmo
 * que o usuário final encontra.
 */

/** Nome do parâmetro de query que carrega o token. Não há alternativa aceita. */
export const TOKEN_PARAM = "sasi-token";

/**
 * Assinatura mínima compartilhada por `URLSearchParams` (servidor) e pelo
 * `ReadonlyURLSearchParams` do `useSearchParams` (cliente).
 */
export interface ReadableSearchParams {
  get(name: string): string | null;
}

/**
 * Devolve o token da URL ou `null` quando a URL não está no modelo esperado.
 * `null` significa sempre "usuário sem acesso" — quem chama não deve inventar
 * usuário nem seguir adiante.
 */
export function readSasiToken(params: ReadableSearchParams): string | null {
  const raw = params.get(TOKEN_PARAM);
  if (typeof raw !== "string") return null;

  const token = raw.trim();
  return token.length > 0 ? token : null;
}

/**
 * Query string pronta para propagar o token em links e `fetch` internos.
 * Sem token a query sai vazia e a requisição será recusada com 401 — o que é o
 * comportamento desejado, já que sem token não há acesso.
 */
export function sasiTokenQuery(token: string | null): string {
  return token ? `?${TOKEN_PARAM}=${encodeURIComponent(token)}` : "";
}

/** Mensagem única exibida/retornada quando a URL não traz `sasi-token`. */
export const NO_ACCESS_MESSAGE =
  "Acesso negado. Abra a página com ?sasi-token=SEU_TOKEN na URL.";
