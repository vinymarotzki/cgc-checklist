"use client";

/**
 * Painel de controle: resumos de checklists e atividades do CGC finalizados,
 * com exportação em XLSX. Página pública de propósito — sem sasi-token, sem
 * link em nenhuma outra tela do app (ver CLAUDE.md, seção Auth). Só acessível
 * por quem sabe a URL. Desktop apenas por enquanto, sem tratamento mobile.
 */

import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Download, RefreshCw } from "lucide-react";

interface CompletedChecklist {
  id: string;
  user_name: string;
  total_items: number;
  completed_items: number;
  created_at?: string;
  completed_at: string;
}

interface CompletedChecklistItem {
  id: string;
  description: string;
  category: string;
  status: string;
  observation: string | null;
  responsible: string | null;
  updated_at: string;
}

interface CgcGroupSummary {
  id: string;
  name: string;
  concluded: number;
}

interface CgcConcludedActivity {
  id: string;
  description: string;
  deadline: string | null;
  comments: string;
  responsible: string;
  updatedAt: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDateOnly(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTimeOnly(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getCellWidth(value: string | number | null | undefined) {
  const text = value === undefined || value === null ? "" : String(value);
  return Math.min(Math.max(text.length + 2, 12), 50);
}

function downloadWorkbook(rows: unknown[][], sheetName: string, fileName: string) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = rows[0].map((_, colIndex) => ({
    wch: Math.max(...rows.map((row) => getCellWidth(row[colIndex] as string | number | null | undefined)), 12),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.setAttribute("download", fileName);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

function exportChecklistXlsx(checklist: CompletedChecklist, items: CompletedChecklistItem[]) {
  const titleRow = [
    "Data de Criação", "Data de Finalização", "Horário de Finalização",
    "Usuário Responsável pela Finalização", "Percentual Concluído", "", "",
  ];
  const metaRow = [
    formatDateOnly(checklist.created_at || checklist.completed_at),
    formatDateOnly(checklist.completed_at),
    formatTimeOnly(checklist.completed_at),
    checklist.user_name,
    `${Math.round((checklist.completed_items / checklist.total_items) * 100)}%`,
    "", "",
  ];
  const headerRow = ["Categoria", "Atividade", "Status", "Observação", "Usuário Responsável", "Data/Hora da Última Alteração"];

  const rows: unknown[][] = [titleRow, metaRow, [], headerRow];
  items.forEach((item) => {
    rows.push([
      item.category, item.description, item.status,
      item.observation || "", item.responsible || "", item.updated_at,
    ]);
  });

  downloadWorkbook(rows, "Checklist", `checklist-completo-${checklist.completed_at.slice(0, 10)}.xlsx`);
}

function exportCgcXlsx(groupName: string, activities: CgcConcludedActivity[]) {
  const headerRow = ["Grupo", "Descrição", "Prazo", "Status", "Comentários", "Responsável", "Data da Conclusão"];
  const rows: unknown[][] = [headerRow];
  activities.forEach((activity) => {
    rows.push([
      groupName, activity.description, activity.deadline || "",
      "CONCLUÍDO", activity.comments, activity.responsible, activity.updatedAt,
    ]);
  });

  downloadWorkbook(rows, "CGC", `cgc-${groupName.toLowerCase()}-concluidas-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export default function ControlePage() {
  const [loading, setLoading] = useState(true);

  const [completedChecklists, setCompletedChecklists] = useState<CompletedChecklist[]>([]);
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  const [selectedChecklistItems, setSelectedChecklistItems] = useState<CompletedChecklistItem[]>([]);
  const [fetchingItems, setFetchingItems] = useState(false);
  const [exportingChecklist, setExportingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState<string | null>(null);

  const [cgcGroups, setCgcGroups] = useState<CgcGroupSummary[]>([]);
  const [exportingGroupId, setExportingGroupId] = useState<string | null>(null);
  const [cgcError, setCgcError] = useState<string | null>(null);

  const fetchChecklists = useCallback(async () => {
    try {
      const res = await fetch("/api/controle/checklists");
      if (!res.ok) return;
      const data = await res.json();
      const completed: CompletedChecklist[] = data.completed || [];
      setCompletedChecklists(completed);
      if (!selectedChecklistId && completed.length > 0) {
        setSelectedChecklistId(completed[0].id);
      }
    } catch {
      setChecklistError("Falha ao carregar os checklists finalizados.");
    }
  }, [selectedChecklistId]);

  const fetchCgcGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/controle/cgc");
      if (!res.ok) return;
      const data = await res.json();
      setCgcGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch {
      setCgcError("Falha ao carregar o resumo do CGC.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([fetchChecklists(), fetchCgcGroups()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedChecklistId) return;
    setFetchingItems(true);
    fetch(`/api/controle/checklists?checklist_id=${encodeURIComponent(selectedChecklistId)}`)
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setSelectedChecklistItems(data.items || []))
      .catch(() => setSelectedChecklistItems([]))
      .finally(() => setFetchingItems(false));
  }, [selectedChecklistId]);

  function handleExportChecklist() {
    setChecklistError(null);
    const checklist = completedChecklists.find((entry) => entry.id === selectedChecklistId);
    if (!checklist) {
      setChecklistError("Selecione um checklist antes de exportar.");
      return;
    }
    if (selectedChecklistItems.length === 0) {
      setChecklistError("Nenhum item encontrado para o checklist selecionado.");
      return;
    }
    setExportingChecklist(true);
    try {
      exportChecklistXlsx(checklist, selectedChecklistItems);
    } catch {
      setChecklistError("Erro ao exportar XLSX.");
    } finally {
      setExportingChecklist(false);
    }
  }

  async function handleExportCgcGroup(group: CgcGroupSummary) {
    setCgcError(null);
    setExportingGroupId(group.id);
    try {
      const res = await fetch(`/api/controle/cgc/activities?group=${encodeURIComponent(group.id)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCgcError(data?.error || "Falha ao exportar as atividades do CGC.");
        return;
      }
      const activities: CgcConcludedActivity[] = data.activities || [];
      if (activities.length === 0) {
        setCgcError(`Nenhuma atividade concluída encontrada para ${group.name}.`);
        return;
      }
      exportCgcXlsx(group.name, activities);
    } catch {
      setCgcError("Falha de conexão ao exportar as atividades do CGC.");
    } finally {
      setExportingGroupId(null);
    }
  }

  const totalFinalizations = completedChecklists.length;
  const uniqueFinalizers = new Set(completedChecklists.map((c) => c.user_name)).size;
  const totalCgcConcluded = cgcGroups.reduce((sum, g) => sum + g.concluded, 0);

  if (loading) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "grid", placeItems: "center", color: "#E8EAF0" }}>
        Carregando controle...
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header-inner" style={{ flexDirection: "row", flexWrap: "nowrap" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>Controle</h1>
            <p style={{ margin: "4px 0 0", color: "#E8EAF0", fontSize: 13 }}>
              Resumo de checklists e atividades do CGC finalizados
            </p>
          </div>
        </div>
      </header>

      <main className="page-container">
        <div className="history-stats-grid">
          <div className="history-stat-card">
            <div className="history-stat-value">{totalFinalizations}</div>
            <div className="history-stat-label">Finalizações de checklist</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">{uniqueFinalizers}</div>
            <div className="history-stat-label">Finalizadores únicos</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">{totalCgcConcluded}</div>
            <div className="history-stat-label">Atividades do CGC concluídas</div>
          </div>
        </div>

        <section className="history-completions-section">
          <div className="history-section-header">
            <h2 style={{ color: "#E8EAF0", fontSize: 16, margin: 0 }}>Checklists finalizados</h2>
          </div>

          {completedChecklists.length === 0 ? (
            <div className="history-empty-state">
              <p>Nenhuma finalização de checklist registrada ainda.</p>
            </div>
          ) : (
            <>
              <div className="history-actions-row">
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    value={selectedChecklistId ?? ""}
                    onChange={(e) => setSelectedChecklistId(e.target.value)}
                    style={{
                      background: "#181C27", border: "1px solid #2A3045", borderRadius: 8,
                      color: "#E8EAF0", padding: "10px 14px", flex: "1 1 280px", minWidth: 0, maxWidth: "100%",
                    }}
                  >
                    {completedChecklists.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {formatDate(entry.completed_at)} — {entry.user_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="history-export-button"
                    disabled={!selectedChecklistId || selectedChecklistItems.length === 0 || fetchingItems || exportingChecklist}
                    onClick={handleExportChecklist}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <Download size={14} className={exportingChecklist ? "spin-icon" : undefined} />
                    {exportingChecklist ? "Exportando..." : "Exportar XLSX do Checklist"}
                  </button>
                </div>
              </div>
              {checklistError && (
                <div style={{ marginBottom: 12, color: "#F87171", fontSize: 14 }}>{checklistError}</div>
              )}

              <div className="history-completions-list">
                {completedChecklists.map((entry) => (
                  <div key={entry.id} className="history-completion-card">
                    <div>
                      <div className="history-completion-user">{entry.user_name}</div>
                      <div className="history-completion-meta">
                        {entry.total_items} itens concluídos em {formatDate(entry.completed_at)}
                      </div>
                    </div>
                    <div className="history-completion-count">{entry.completed_items}/{entry.total_items}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="history-completions-section">
          <div className="history-section-header">
            <h2 style={{ color: "#E8EAF0", fontSize: 16, margin: 0 }}>Atividades do CGC concluídas</h2>
          </div>

          {cgcError && (
            <div style={{ marginBottom: 12, color: "#F87171", fontSize: 14 }}>{cgcError}</div>
          )}

          {cgcGroups.length === 0 ? (
            <div className="history-empty-state">
              <p>Nenhum grupo cadastrado ainda.</p>
            </div>
          ) : (
            <div className="history-completions-list">
              {cgcGroups.map((group) => (
                <div key={group.id} className="history-completion-card">
                  <div>
                    <div className="history-completion-user">{group.name}</div>
                    <div className="history-completion-meta">
                      {group.concluded === 1 ? "1 atividade concluída" : `${group.concluded} atividades concluídas`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="history-export-button"
                    disabled={group.concluded === 0 || exportingGroupId === group.id}
                    onClick={() => handleExportCgcGroup(group)}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0, padding: "8px 12px" }}
                  >
                    <Download size={13} className={exportingGroupId === group.id ? "spin-icon" : undefined} />
                    <span className="btn-label-desktop">{exportingGroupId === group.id ? "Exportando..." : "Exportar XLSX"}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => { setLoading(true); Promise.all([fetchChecklists(), fetchCgcGroups()]).finally(() => setLoading(false)); }}
            style={{
              background: "transparent", border: "1px solid #2A3045", color: "#E8EAF0",
              borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin-icon { animation: spin 0.8s linear infinite; }`}</style>
    </div>
  );
}
