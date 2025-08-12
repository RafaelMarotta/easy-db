import React from "react";

export interface ToolbarProps {
  onRefresh: () => void;
  showEditingControls: boolean;
  onAddRow: () => void;
  onCommit: () => void;
  hasEdits: boolean;
  columnsCount: number;
  rowsCount: number;
  children?: React.ReactNode; // for right-side extra controls (e.g., pagination)
}

export function Toolbar(props: ToolbarProps) {
  const { onRefresh, showEditingControls, onAddRow, onCommit, hasEdits, columnsCount, rowsCount, children } = props;
  return (
    <div style={{ padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--vscode-panel-border)", backgroundColor: "var(--vscode-toolbar-background)" }}>
      <button onClick={onRefresh} title="Refresh" style={{ background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)", border: "1px solid var(--vscode-button-border)", padding: "4px 8px", borderRadius: 3, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <i className="codicon codicon-refresh" /> Refresh
      </button>
      {showEditingControls && (
        <>
          <button onClick={onAddRow} title="Add row" disabled={columnsCount === 0} style={{ background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)", border: "1px solid var(--vscode-button-border)", padding: "4px 8px", borderRadius: 3, cursor: columnsCount === 0 ? "not-allowed" : "pointer", opacity: columnsCount === 0 ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i className="codicon codicon-add" /> Add row
          </button>
          <button onClick={onCommit} title="Commit" disabled={!hasEdits} style={{ background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)", border: "1px solid var(--vscode-button-border)", padding: "4px 8px", borderRadius: 3, cursor: !hasEdits ? "not-allowed" : "pointer", opacity: !hasEdits ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i className="codicon codicon-check" /> Commit
          </button>
        </>
      )}
      <span style={{ color: "var(--vscode-descriptionForeground)", fontSize: 12, marginLeft: "auto" }}>Columns: {columnsCount} · Rows: {rowsCount}</span>
      {children}
    </div>
  );
}


