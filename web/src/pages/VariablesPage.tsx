import React, { useCallback, useEffect, useMemo, useState } from "react";

type Variable = { id: string; value: string };

const vscode: { postMessage: (msg: any) => void } =
  (window as any).acquireVsCodeApi?.() || { postMessage: (_: unknown) => {} };

export function VariablesPage() {
  const [items, setItems] = useState<Variable[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const onMessage = (e: MessageEvent<any>) => {
      const msg = e.data;
      switch (msg.type) {
        case "variablesList":
          setItems(msg.items || []);
          break;
        case "variablesSaved":
          setStatus("Variables saved");
          vscode.postMessage({ type: "variablesList" });
          break;
        case "variableDeleted":
          setStatus("Variable deleted");
          vscode.postMessage({ type: "variablesList" });
          break;
        case "error":
          setError(String(msg.message || "Error"));
          break;
      }
    };
    window.addEventListener("message", onMessage as any);
    // trigger initial fetch
    vscode.postMessage({ type: "variablesList" });
    return () => window.removeEventListener("message", onMessage as any);
  }, []);

  const add = useCallback(() => setItems(prev => [...prev, { id: "", value: "" }]), []);
  const updateName = useCallback((i: number, id: string) => setItems(prev => {
    const next = prev.slice();
    next[i] = { ...next[i], id };
    return next;
  }), []);
  const updateValue = useCallback((i: number, value: string) => setItems(prev => {
    const next = prev.slice();
    next[i] = { ...next[i], value };
    return next;
  }), []);
  const remove = useCallback((id: string) => vscode.postMessage({ type: "variableDelete", id }), []);
  const saveAll = useCallback(() => vscode.postMessage({ type: "variablesBulkSave", items }), [items]);

  const buttonStyle: React.CSSProperties = {
    padding: "6px 10px",
    backgroundColor: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    border: "1px solid var(--vscode-button-border)",
    borderRadius: 4,
    cursor: "pointer"
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    backgroundColor: "var(--vscode-input-background)",
    color: "var(--vscode-input-foreground)",
    border: "1px solid var(--vscode-input-border)",
    borderRadius: 4,
    boxSizing: "border-box",
    height: 32
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--vscode-editor-background)", color: "var(--vscode-foreground)", padding: 20 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, margin: 0, display: "flex", gap: 8, alignItems: "center" }}>
            <i className="codicon codicon-symbol-variable" /> Variables
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={add} style={buttonStyle}>+ Add Variable</button>
            <button onClick={saveAll} style={buttonStyle}>Save All ({items.length})</button>
          </div>
        </header>

        {error && (
          <div style={{ marginBottom: 12, color: "var(--vscode-errorForeground)", border: "1px solid var(--vscode-inputValidation-errorBorder)", background: "var(--vscode-inputValidation-errorBackground)", padding: 8, borderRadius: 4 }}>{error}</div>
        )}
        {status && !error && (
          <div style={{ marginBottom: 12, border: "1px solid var(--vscode-inputValidation-infoBorder)", background: "var(--vscode-inputValidation-infoBackground)", padding: 8, borderRadius: 4 }}>{status}</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 36px", gap: 10 }}>
          {items.map((v, i) => (
            // Use stable index as key so editing the variable name doesn't remount the row
            <React.Fragment key={i}>
              <input value={v.id} onChange={e => updateName(i, e.target.value)} placeholder="name" style={inputStyle} />
              <input value={v.value} onChange={e => updateValue(i, e.target.value)} placeholder="value" style={inputStyle} />
              <button aria-label="Delete" onClick={() => remove(v.id)} title="Delete" style={{ ...buttonStyle, background: "transparent", color: "var(--vscode-errorForeground)" }}>
                <i className="codicon codicon-trash" />
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}


