import { useCallback, useRef, useState } from "react";
import { defaultFormatter } from "./formatters";

export function useCrudEdits(dateTimeCols: Set<string>, readOnly: boolean) {
  const [hasEdits, setHasEdits] = useState(false);
  const editsRef = useRef<Map<number, Record<string, any>>>(new Map());

  const handleCellEdit = useCallback((rowIndex: number, columnId: string, value: string) => {
    const patch = editsRef.current.get(rowIndex) || {};
    patch[columnId] = value;
    editsRef.current.set(rowIndex, patch);
    setHasEdits(true);
  }, []);

  const formatRowForBackend = useCallback((row: Record<string, any>) => {
    const out: Record<string, any> = { ...row };
    for (const col of dateTimeCols) {
      if (!(col in out)) continue;
      const v = out[col];
      if (v == null || v === "") continue;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[col] = defaultFormatter.toSqlDate(String(v));
      else out[col] = defaultFormatter.toSqlDateTime(String(v));
    }
    return out;
  }, [dateTimeCols]);

  const clearEdits = useCallback(() => {
    editsRef.current.clear();
    setHasEdits(false);
  }, []);

  return { editsRef, hasEdits, setHasEdits, handleCellEdit, formatRowForBackend, clearEdits } as const;
}


