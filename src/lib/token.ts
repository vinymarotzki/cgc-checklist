/**
 * Leitura do token de acesso — fonte única para cliente e servidor.
 *
 * O token só entra pela URL uma única vez, no primeiro acesso: o hook
 * `useSasiToken` (`@/hooks/useSasiToken`) lê `sasi-token` da URL, guarda em
 * `sessionStorage` e limpa o parâmetro da barra de endereço. A partir daí,
 * páginas e `fetch` internos carregam o token pelo header `x-sasi-token` — a
 * URL nunca mais volta a exibi-lo. Qualquer outra forma — parâmetro ausente,
 * nome diferente, valor vazio ou só com espaços — é tratada como "sem
 * acesso". Não existe bypass por host: localhost segue exatamente a mesma
 * regra da produção.
 */

/** Nome do parâmetro de query aceito só no primeiro acesso. Não há alternativa. */
export const TOKEN_PARAM = "sasi-token";

/** Header usado para carregar o token em toda requisição interna após o primeiro acesso. */
export const TOKEN_HEADER = "x-sasi-token";

/** Chave usada para guardar o token em `sessionStorage` no cliente. */
export const TOKEN_STORAGE_KEY = "sasi-token";

/**
 * Assinatura mínima compartilhada por `URLSearchParams` (servidor) e pelo
 * `ReadonlyURLSearchParams` do `useSearchParams` (cliente).
 */
export interface ReadableSearchParams {
  get(name: string): string | null;
}

/** Assinatura mínima compartilhada por `Headers` (cliente e servidor). */
export interface ReadableHeaders {
  get(name: string): string | null;
}

function normalizeToken(raw: string | null): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  return token.length > 0 ? token : null;
}

/**
 * Devolve o token de `sasi-token` na URL, ou `null` quando ausente/vazio.
 * Usado só no primeiro acesso, antes do token ir para `sessionStorage`.
 */
export function readSasiToken(params: ReadableSearchParams): string | null {
  return normalizeToken(params.get(TOKEN_PARAM));
}

/**
 * Devolve o token do header `x-sasi-token`, ou `null` quando ausente/vazio.
 * É o que toda rota de API deve usar para autenticar requisições internas.
 */
export function readSasiTokenHeader(headers: ReadableHeaders): string | null {
  return normalizeToken(headers.get(TOKEN_HEADER));
}

/** Header pronto para anexar a um `fetch` interno. Sem token, devolve objeto vazio. */
export function sasiAuthHeaders(token: string | null): Record<string, string> {
  return token ? { [TOKEN_HEADER]: token } : {};
}

/** Mensagem única exibida/retornada quando não há token válido. */
export const NO_ACCESS_MESSAGE =
  "Acesso negado. Abra a página com ?sasi-token=SEU_TOKEN na URL.";
