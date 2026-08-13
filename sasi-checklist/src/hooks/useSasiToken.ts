"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TOKEN_PARAM, TOKEN_STORAGE_KEY, readSasiToken } from "@/lib/token";

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

/**
 * Fonte única do token no cliente. Só a primeira URL de acesso carrega
 * `?sasi-token=`; este hook lê esse parâmetro, guarda em `sessionStorage` e
 * limpa a URL (para o token nunca mais aparecer na barra de endereço ou em
 * links). Navegações seguintes recuperam o token do `sessionStorage`.
 */
export function useSasiToken(): string | null {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlToken = readSasiToken(searchParams);

  const [token, setToken] = useState<string | null>(() => urlToken || readStoredToken());

  useEffect(() => {
    if (!urlToken) {
      setToken(readStoredToken());
      return;
    }

    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, urlToken);
    setToken(urlToken);

    const params = new URLSearchParams(searchParams.toString());
    params.delete(TOKEN_PARAM);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlToken]);

  return token;
}
