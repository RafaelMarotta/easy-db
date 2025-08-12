import React from "react";
import { CellEditorProps } from "./types";

export function BooleanEditor({ value, rowIndex, columnId, readOnly, onEdit }: CellEditorProps) {
  const checked = value === true || value === 1 || String(value).toLowerCase() === "true";
  if (readOnly) {
    return (
      <div style={{ padding: "4px 8px" }}>
        <input type="checkbox" checked={checked} disabled />
      </div>
    );
  }
  return (
    <div style={{ padding: "2px 6px" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onEdit(rowIndex, columnId, e.target.checked ? "1" : "0")}
      />
    </div>
  );
}


