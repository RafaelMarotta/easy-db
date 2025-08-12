import React from "react";
import { CellEditorProps } from "./types";

export function NumberEditor({ value, rowIndex, columnId, readOnly, onEdit }: CellEditorProps) {
  if (readOnly) return <div style={{ padding: "4px 8px", color: "var(--vscode-descriptionForeground)" }}>{value == null ? "" : String(value)}</div>;
  const [local, setLocal] = React.useState(value == null ? "" : String(value));
  const [err, setErr] = React.useState<string>("");
  React.useEffect(() => { setLocal(value == null ? "" : String(value)); setErr(""); }, [value]);
  return (
    <div>
      <input
        type="number"
        value={local}
        onChange={(e) => {
          const v = e.target.value; setLocal(v);
          const n = Number(v); setErr(v !== '' && Number.isNaN(n) ? 'Invalid number' : '');
          onEdit(rowIndex, columnId, v);
        }}
        onBlur={() => onEdit(rowIndex, columnId, local)}
        style={{ width: "100%", background: "transparent", border: `1px solid ${err ? 'var(--vscode-inputValidation-errorBorder)' : 'transparent'}`, color: "var(--vscode-foreground)", padding: "4px 8px", outline: "none", borderRadius: 3 }}
      />
      {err && <div style={{ color: 'var(--vscode-inputValidation-errorForeground)', fontSize: 11, paddingTop: 2 }}>{err}</div>}
    </div>
  );
}


