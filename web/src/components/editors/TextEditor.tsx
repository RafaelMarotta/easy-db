import React from "react";
import { CellEditorProps } from "./types";

export function TextEditor({ value, rowIndex, columnId, readOnly, onEdit }: CellEditorProps) {
  if (readOnly) return <div style={{ padding: "4px 8px", color: "var(--vscode-descriptionForeground)" }}>{value == null ? "" : String(value)}</div>;
  const [local, setLocal] = React.useState(value == null ? "" : String(value));
  React.useEffect(() => { setLocal(value == null ? "" : String(value)); }, [value]);
  return (
    <input
      type="text"
      value={local}
      onChange={(e) => { const v = e.target.value; setLocal(v); onEdit(rowIndex, columnId, v); }}
      onBlur={() => onEdit(rowIndex, columnId, local)}
      style={{ width: "100%", background: "transparent", border: "1px solid transparent", color: "var(--vscode-foreground)", padding: "4px 8px", outline: "none", borderRadius: 3 }}
    />
  );
}


