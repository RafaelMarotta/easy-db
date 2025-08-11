import React, { useCallback, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import DataEditor, { GridCell, GridCellKind, Item } from "@glideapps/glide-data-grid";

type Message =
  | { type: "init" }
  | { type: "queryChunk"; columns: string[]; rows: any[] }
  | { type: "queryDone"; rowCount: number }
  | { type: "schema"; pkColumns: string[] }
  | { type: "mutationDone"; affected: number }
  | { type: "error"; message: string };

const vscode = (window as any).acquireVsCodeApi?.() || { postMessage: (_: any) => {} };

function App() {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [pk, setPk] = useState<Set<string>>(new Set());
  const editsRef = useRef<Map<number, Record<string, any>>>(new Map());

  const gridColumns = useMemo(() => columns.map(c => ({ title: c })), [columns]);

  const getCellContent = useCallback((item: Item): GridCell => {
    const [col, row] = item;
    const key = columns[col];
    const r: any = rows[row];
    const value = r ? r[key] : undefined;
    return {
      kind: GridCellKind.Text,
      displayData: value == null ? "" : String(value),
      data: value == null ? "" : String(value),
      allowOverlay: true,
      readonly: pk.has(key),
    } as any;
  }, [columns, rows, pk]);

  const onCellEdited = useCallback((cell: Item, newValue: GridCell) => {
    const [col, row] = cell;
    const key = columns[col];
    if (pk.has(key)) return;
    const newText = (newValue as any).data as string;
    const patch = editsRef.current.get(row) ?? {};
    patch[key] = newText;
    editsRef.current.set(row, patch);
  }, [columns, pk]);

  const commit = useCallback(async () => {
    for (const [rowIdx, patch] of editsRef.current.entries()) {
      const row = rows[rowIdx];
      const pkObj: Record<string, any> = {};
      const pkCols = Array.from(pk);
      if (pkCols.length) {
        for (const k of pkCols) pkObj[k] = row[k];
      } else if (columns.length) {
        pkObj[columns[0]] = row[columns[0]];
      }
      vscode.postMessage({ type: "editRow", pk: pkObj, patch });
    }
    editsRef.current.clear();
  }, [rows, pk, columns]);

  const refresh = useCallback(() => {
    setColumns([]); setRows([]); editsRef.current.clear();
    vscode.postMessage({ type: "fetchPage", pageSize: 100, offset: 0 });
  }, []);

  React.useEffect(() => {
    const onMessage = (e: MessageEvent<Message>) => {
      const msg = e.data;
      if (msg.type === "schema") setPk(new Set(msg.pkColumns || []));
      if (msg.type === "queryChunk") {
        if (columns.length === 0) setColumns(msg.columns);
        setRows(prev => prev.concat(msg.rows));
      }
      if (msg.type === "queryDone") {
        // noop
      }
    };
    window.addEventListener("message", onMessage as any);
    vscode.postMessage({ type: "fetchPage", pageSize: 100, offset: 0 });
    return () => window.removeEventListener("message", onMessage as any);
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 6, display: "flex", gap: 8 }}>
        <button onClick={refresh} title="Refresh"><i className="codicon codicon-refresh" /></button>
        <button onClick={commit} title="Commit"><i className="codicon codicon-check" /></button>
      </div>
      <div style={{ flex: 1 }}>
        <DataEditor
          columns={gridColumns as any}
          getCellContent={getCellContent}
          rows={rows.length}
          onCellEdited={onCellEdited}
          smoothScrollX smoothScrollY
        />
      </div>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById("root"));


