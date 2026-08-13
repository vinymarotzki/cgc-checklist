/**
 * Cor de identidade dos grupos do CGC.
 *
 * Os quatro grupos semeados (`db:seed`) têm cor fixa de marca — não a cor
 * derivada por hash de `getCategoryColor`, que existe para grupos criados
 * depois, sem identidade definida.
 */

import { getCategoryColor } from "@/lib/checklist-status";

const FIXED_GROUP_COLORS: Record<string, string> = {
  CGC: "#004AAD",
  NUPPAE: "#FF3131",
  NGOA: "#FF751F",
  CIPA: "#457A00",
};

/** Cor fixa para os grupos de marca; hash estável de `getCategoryColor` para os demais. */
export function getCgcGroupColor(name: string | null | undefined): string {
  const key = name?.trim().toUpperCase() ?? "";
  return FIXED_GROUP_COLORS[key] ?? getCategoryColor(name || "Sem grupo");
}
