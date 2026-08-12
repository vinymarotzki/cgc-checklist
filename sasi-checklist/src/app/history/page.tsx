"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import * as XLSX from "xlsx";

interface HistoryEntry {
  id: string;
  activity_id: string;
  activity: string;
  category: string;
  old_status: string;
  new_status: string;
  user_id: string;
  user_name: string;
  observation: string | null;
  created_at: string;
}

interface CompletedChecklistEntry {
  id: string;
  user_id: string;
  user_name: string;
  total_items: number;
  completed_items: number;
  created_at?: string;
  completed_at: string;
}

interface CompletedChecklistItem {
  id: string;
  activity_id: string;
  description: string;
  category: string;
  status: string;
  observation: string | null;
  responsible: string | null;
  updated_at: string;
}

interface User {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<string, string> = {
  SEM_STATUS: "Sem Status",
  NAO_INICIADO: "Não Iniciado",
  EM_ANDAMENTO: "Em Andamento",
  CONCLUIDO: "Concluído",
  IMPEDIDO: "Impedido",
};

const STATUS_COLOR: Record<string, string> = {
  SEM_STATUS: "#7A82A0",
  NAO_INICIADO: "#b10202",
  EM_ANDAMENTO: "#ffe5a0",
  CONCLUIDO: "#11734b",
  IMPEDIDO: "#b10202",
};

const OBSERVATION_EVENT_PREFIXES = [
  { prefix: "Observação adicionada:", label: "Observação criada", color: "#60A5FA" },
  { prefix: "Observação editada:", label: "Observação editada", color: "#F59E0B" },
  { prefix: "Observação apagada:", label: "Observação apagada", color: "#F87171" },
];

function getObservationEvent(observation: string | null) {
  if (!observation) return null;
  return OBSERVATION_EVENT_PREFIXES.find((event) => observation.startsWith(event.prefix)) || null;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function formatDateOnly(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function formatTimeOnly(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function escapeCsv(value: string | number | null | undefined) {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (text.includes("\"") || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/\"/g, '""')}"`;
  }
  return text;
}

function getCellWidth(value: string | number | null | undefined) {
  const text = value === undefined || value === null ? "" : String(value);
  return Math.min(Math.max(text.length + 2, 12), 50);
}

function exportChecklistXlsx(checklist: CompletedChecklistEntry, items: CompletedChecklistItem[]) {
  const titleRow = [
    "Data de Criação",
    "Data de Finalização",
    "Horário de Finalização",
    "Usuário Responsável pela Finalização",
    "Percentual Concluído",
    "",
    "",
  ];
  const metaRow = [
    formatDateOnly(checklist.created_at || checklist.completed_at),
    formatDateOnly(checklist.completed_at),
    formatTimeOnly(checklist.completed_at),
    checklist.user_name,
    `${Math.round((checklist.completed_items / checklist.total_items) * 100)}%`,
    "",
    "",
  ];
  const headerRow = [
    "Seção",
    "Subcategoria",
    "Atividade",
    "Categoria",
    "Status",
    "Observação",
    "Usuário Responsável",
    "Data/Hora da Última Alteração",
  ];

  const rows = [titleRow, metaRow, [], headerRow];
  items.forEach((item) => {
    rows.push([
      item.category,
      "",
      item.description,
      item.category,
      item.status,
      item.observation || "",
      item.responsible || "",
      item.updated_at,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = rows[0].map((_, colIndex) => ({ wch: Math.max(...rows.map((row) => getCellWidth(row[colIndex])), 12) }));
  ws["!freeze"] = { ySplit: 4 };

  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let R = 0; R <= range.e.r; ++R) {
    for (let C = 0; C <= range.e.c; ++C) {
      const address = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[address];
      if (!cell) continue;
      cell.s = cell.s || {};
      if (R === 0 || R === 1 || R === 3) {
        cell.s.font = { bold: true };
      }
      if (C === 2 || C === 5) {
        cell.s.alignment = { wrapText: true, vertical: "top" };
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Checklist");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.setAttribute("download", `checklist-completo-${checklist.completed_at.slice(0, 10)}.xlsx`);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

function HistoryPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("sasi-token") || searchParams.get("token") || "";

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [completedChecklists, setCompletedChecklists] = useState<CompletedChecklistEntry[]>([]);
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  const [selectedChecklistItems, setSelectedChecklistItems] = useState<CompletedChecklistItem[]>([]);
  const [fetchingItems, setFetchingItems] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const isLocalDev =
    typeof window !== "undefined" &&
    window.location.protocol === "http:" &&
    /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);

  const fetchHistory = useCallback(async () => {
    if (!token && !isLocalDev) { setAuthError(true); setLoading(false); return; }
    try {
      const query = token ? `?sasi-token=${encodeURIComponent(token)}` : "";
      const res = await fetch(`/api/history${query}`);
      if (!res.ok) { setAuthError(true); setLoading(false); return; }
      const data = await res.json();
      setHistory(data.history);
      setCompletedChecklists(data.completed || []);
      setUser(data.user);
      if (!selectedChecklistId && data.completed && data.completed.length > 0) {
        setSelectedChecklistId(data.completed[0].id);
      }
    } catch (error) {
      console.error("Erro no fetchHistory:", error);
      setAuthError(true);
    } finally {
      setLoading(false);
    }
  }, [token, isLocalDev, selectedChecklistId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!selectedChecklistId || (!token && !isLocalDev)) return;

    const fetchChecklistItems = async () => {
      setFetchingItems(true);
      try {
        const query = token
          ? `?sasi-token=${encodeURIComponent(token)}&checklist_id=${encodeURIComponent(selectedChecklistId)}`
          : `?checklist_id=${encodeURIComponent(selectedChecklistId)}`;
        console.log("Enviando request de checklist detalhado para /api/history", query);
        const res = await fetch(`/api/history${query}`);
        console.log("Response status from /api/history:", res.status);
        if (!res.ok) {
          console.error("Resposta não OK da rota /api/history", await res.text());
          setSelectedChecklistItems([]);
          return;
        }
        const data = await res.json();
        console.log("Dados retornados de selectedChecklistItems:", data.selectedChecklistItems);
        setSelectedChecklistItems(data.selectedChecklistItems || []);
      } catch (error) {
        console.error("Erro ao buscar itens do checklist selecionado:", error);
        setSelectedChecklistItems([]);
      } finally {
        setFetchingItems(false);
      }
    };

    fetchChecklistItems();
  }, [selectedChecklistId, token, isLocalDev]);

  const handleExport = () => {
    console.log("Botão clicado");
    console.log("Checklist selecionado:", selectedChecklistId);
    setExportError(null);
    if (!selectedChecklistId) {
      setExportError("Selecione um checklist antes de exportar.");
      return;
    }
    const checklist = completedChecklists.find((entry) => entry.id === selectedChecklistId);
    if (!checklist) {
      setExportError("Checklist selecionado não encontrado.");
      return;
    }
    if (selectedChecklistItems.length === 0) {
      setExportError("Nenhum item encontrado para o checklist selecionado.");
      return;
    }

    setExporting(true);
    try {
      console.log("Gerando XLSX...");
      exportChecklistXlsx(checklist, selectedChecklistItems);
      console.log("Download iniciado");
    } catch (error) {
      console.error("Erro ao exportar XLSX:", error);
      setExportError("Erro ao exportar XLSX. Veja o console para mais detalhes.");
    } finally {
      setExporting(false);
    }
  };

  const filtered = history.filter((h) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (
      h.activity?.toLowerCase().includes(s) ||
      h.user_name?.toLowerCase().includes(s) ||
      h.category?.toLowerCase().includes(s)
    );
  });

  if (loading) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 40, height: 40, border: "3px solid #2A3045",
            borderTopColor: "#3B6EF5", borderRadius: "50%",
            animation: "spin 0.8s linear infinite", margin: "0 auto 16px"
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: "#7A82A0", fontSize: 14 }}>Carregando histórico...</p>
        </div>
      </div>
    );
  }

  if (authError || !user) {
    return (
      <div style={{ background: "#0F1117", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          background: "#181C27", border: "1px solid #2A1A1A",
          borderRadius: 12, padding: "40px 48px", textAlign: "center", maxWidth: 400
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <h2 style={{ color: "#F87171", fontSize: 20, fontWeight: 600 }}>Acesso negado</h2>
          <p style={{ color: "#7A82A0", fontSize: 14 }}>Token inválido ou não informado.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <header className="history-header">
        <div className="history-header-inner">
          <div className="history-header-left">
            <Link
              href={isLocalDev ? "/" : `/?sasi-token=${encodeURIComponent(token)}`}
              className="history-back-link"
            >
              ← Checklist
            </Link>
          </div>
          <div className="history-header-main">
            <span className="history-page-title">Histórico de Alterações</span>
            <span className="history-user-badge">
              <span>{user.name.charAt(0).toUpperCase()}</span>
              <span>{user.name}</span>
            </span>
          </div>
        </div>
      </header>

      <main className="page-container">
        <div className="history-stats-grid">
          <div className="history-stat-card">
            <div className="history-stat-value">{history.length}</div>
            <div className="history-stat-label">Total de alterações</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">
              {history.filter((h) => h.new_status === "CONCLUIDO").length}
            </div>
            <div className="history-stat-label">Marcadas concluídas</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">{completedChecklists.length}</div>
            <div className="history-stat-label">Finalizações de checklist</div>
          </div>
          <div className="history-stat-card">
            <div className="history-stat-value">{new Set(completedChecklists.map((c) => c.user_id)).size}</div>
            <div className="history-stat-label">Finalizadores únicos</div>
          </div>
        </div>

        <div className="history-actions-row">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={selectedChecklistId ?? ""}
              onChange={(e) => setSelectedChecklistId(e.target.value)}
              style={{
                background: "#181C27",
                border: "1px solid #2A3045",
                borderRadius: 8,
                color: "#E8EAF0",
                padding: "10px 14px",
                minWidth: 280,
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
              disabled={!selectedChecklistId || selectedChecklistItems.length === 0 || fetchingItems || exporting}
              onClick={handleExport}
            >
              {exporting ? "Exportando..." : "Exportar XLSX do Checklist"}
            </button>
          </div>
        </div>
        {exportError && (
          <div style={{ marginTop: 12, color: "#F87171", fontSize: 14 }}>
            {exportError}
          </div>
        )}

        <div className="history-search">
          <input
            className="history-search-input"
            type="text"
            placeholder="Buscar no histórico..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <span className="search-icon">🔍</span>
        </div>

        <section className="history-completions-section">
          <div className="history-section-header">
            <h2 style={{ color: "#E8EAF0", fontSize: 16, margin: 0 }}>Finalizações de checklist</h2>
          </div>
          {completedChecklists.length === 0 ? (
            <div className="history-empty-state">
              <p>Nenhuma finalização de checklist registrada ainda.</p>
            </div>
          ) : (
            <div className="history-completions-list">
              {completedChecklists.map((entry) => (
                <div key={entry.id} className="history-completion-card">
                  <div>
                    <div className="history-completion-user">{entry.user_name}</div>
                    <div className="history-completion-meta">{entry.total_items} itens concluídos em {formatDate(entry.completed_at)}</div>
                  </div>
                  <div className="history-completion-count">{entry.completed_items}/{entry.total_items}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {filtered.length === 0 ? (
          <div className="history-empty-state">
            <p>
              {history.length === 0 ? "Nenhuma alteração registrada ainda." : "Nenhum resultado encontrado."}
            </p>
          </div>
        ) : (
          <div className="history-list">
            {filtered.map((entry) => {
              const event = getObservationEvent(entry.observation);
              const observationText = event
                ? entry.observation?.slice(event.prefix.length).trim()
                : entry.observation;

              const showStatusRow = !(
                event &&
                entry.old_status === "SEM_STATUS" &&
                entry.new_status === "SEM_STATUS"
              );

              return (
                <div
                  key={entry.id}
                  className="history-card"
                  style={{ borderLeftColor: event?.color || STATUS_COLOR[entry.new_status] || "#2A3045" }}
                >
                  <div className="history-card-content">
                    <div className="history-card-main">
                      <div className="history-category-tag">
                        <span className="history-category-badge">
                          {entry.category || "—"}
                        </span>
                      </div>

                      <p className="history-activity">
                        {entry.activity || `Atividade ${entry.activity_id.slice(0, 8)}...`}
                      </p>

                      {showStatusRow && (
                        <div className="history-status-row">
                          <span className="history-status-pill" style={{
                            border: `1px solid ${STATUS_COLOR[entry.old_status] || "#2A3045"}`,
                            color: STATUS_COLOR[entry.old_status] || "#7A82A0",
                            background: `${STATUS_COLOR[entry.old_status] || "#2A3045"}15`
                          }}>
                            {STATUS_LABEL[entry.old_status] || entry.old_status || "—"}
                          </span>
                          <span style={{ color: "#4A5270", fontSize: 12 }}>→</span>
                          <span className="history-status-pill" style={{
                            border: `1px solid ${STATUS_COLOR[entry.new_status] || "#2A3045"}`,
                            color: STATUS_COLOR[entry.new_status] || "#7A82A0",
                            background: `${STATUS_COLOR[entry.new_status] || "#2A3045"}15`
                          }}>
                            {STATUS_LABEL[entry.new_status] || entry.new_status || "—"}
                          </span>
                        </div>
                      )}

                      {event && (
                        <span className="history-observation-badge" style={{
                          borderColor: event.color,
                          color: event.color,
                          background: `${event.color}20`,
                        }}>
                          {event.label}
                        </span>
                      )}
                      {observationText && (
                        <p className="history-observation" style={{ marginTop: event ? 8 : 0 }}>
                          💬 {observationText}
                        </p>
                      )}
                    </div>

                    <div className="history-card-meta">
                      <div className="meta-name">{entry.user_name}</div>
                      <div className="meta-date">{formatDate(entry.created_at)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <HistoryPage />
    </Suspense>
  );
}
