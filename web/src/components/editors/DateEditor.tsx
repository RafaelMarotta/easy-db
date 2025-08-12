import React from "react";
import { CellEditorProps } from "./types";

function pad2(n: number): string { return String(n).padStart(2, "0"); }

export function DateEditor({ value, rowIndex, columnId, readOnly, onEdit }: CellEditorProps) {
  const [local, setLocal] = React.useState<string>("");
  React.useEffect(() => {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      setLocal(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
    } else {
      setLocal("");
    }
  }, [value]);
  if (readOnly) return <div style={{ padding: "4px 8px", color: "var(--vscode-descriptionForeground)" }}>{local}</div>;
  return (
    <input
      type="date"
      value={local}
      onChange={(e) => { const v = e.target.value; setLocal(v); onEdit(rowIndex, columnId, v); }}
      onBlur={() => onEdit(rowIndex, columnId, local)}
      style={{ width: "100%", background: "transparent", border: "1px solid transparent", color: "var(--vscode-foreground)", padding: "4px 8px", outline: "none", borderRadius: 3 }}
    />
  );
}


