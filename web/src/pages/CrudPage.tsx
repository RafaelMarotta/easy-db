import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReactTable, getCoreRowModel, createColumnHelper } from "@tanstack/react-table";
import "@vscode/codicons/dist/codicon.css";
import { PaginationControls } from "../components/PaginationControls";
import { Toolbar } from "../components/Toolbar";
import { DataTable } from "../components/DataTable";
import { usePagination } from "../lib/usePagination";
import { useCrudMessaging } from "../lib/useCrudMessaging";
import { renderEditor } from "../components/editors/EditorRegistry";
import { useContainerSize } from "../lib/useContainerSize";
import { defaultFormatter } from "../lib/formatters";

const vscode: { postMessage: (msg: any) => void } =
  (window as any).acquireVsCodeApi?.() || { postMessage: (_: unknown) => {} };

const EXTERNAL_DATA_MODE: boolean = Boolean((window as any).__EASYDB_EXTERNAL__);

export function CrudPage() {
  // Messaging: abstract post/subscribe
  const bus = React.useMemo(() => ({
    post: (m: any) => vscode.postMessage(m),
    subscribe: (fn: (m: any) => void) => {
      const handler = (e: MessageEvent<any>) => fn(e.data);
      window.addEventListener("message", handler as any);
      return () => window.removeEventListener("message", handler as any);
    },
  }), []);
  const {
    columns, rows, setRows, loading, error, setError,
    sendFetch, hasNextPage, pk, autoCols, dateTimeCols, columnTypes, readOnly,
  } = useCrudMessaging(bus);
  const {
    pageSize, offset,
    setPageSize, setOffset,
    pageSizeInput, setPageSizeInput,
    pageInput, setPageInput,
    applyPageSize, applyPageNumber,
    goPrev, goNext,
  } = usePagination(100);
  const requestIdRef = useRef<string>("");
  const lastStartReqRef = useRef<string>("");
  const [loadingInitial] = useState<boolean>(EXTERNAL_DATA_MODE);
  const { ref: containerRef } = useContainerSize<HTMLDivElement>();
  const [hasEdits, setHasEdits] = useState<boolean>(false);
  const editsRef = useRef<Map<number, Record<string, any>>>(new Map());

  const showEditingControls = !readOnly && columns.length > 0;

  // Notify host when ready in external mode
  useEffect(() => {
    if ((window as any).__EASYDB_EXTERNAL__) {
      try { vscode.postMessage({ type: "ready" }); } catch {}
    }
  }, []);

  const columnHelper = createColumnHelper<any>();

  const handleCellEdit = useCallback((rowIndex: number, columnId: string, value: string) => {
    const patch = editsRef.current.get(rowIndex) || {};
    patch[columnId] = value;
    editsRef.current.set(rowIndex, patch);
    setHasEdits(true);
  }, []);

  const fetchPage = useCallback((nextOffset: number, nextPageSize: number) => {
    setError(null);
    setHasEdits(false);
    editsRef.current.clear();
    setOffset(nextOffset);
    setPageSize(nextPageSize);
    sendFetch(nextPageSize, nextOffset);
  }, [sendFetch, setError]);

  const refresh = useCallback(() => {
    // Full reload to first page
    fetchPage(0, pageSize);
  }, [fetchPage, pageSize]);

  const applyPageSizeWrapped = useCallback(() => applyPageSize(fetchPage), [applyPageSize, fetchPage]);
  const applyPageNumberWrapped = useCallback(() => applyPageNumber(fetchPage), [applyPageNumber, fetchPage]);

  const toggleDeleteRow = useCallback((rowIndex: number) => {
    if (readOnly) return;
    setRows((prev) => {
      const next = [...prev];
      const row = next[rowIndex];
      if (!row) return prev;
      const markDelete = !row.__deleted;
      next[rowIndex] = { ...row, __deleted: markDelete };
      if (markDelete) {
        if (editsRef.current.has(rowIndex)) editsRef.current.delete(rowIndex);
      }
      setHasEdits(true);
      return next;
    });
  }, [readOnly]);

  const addRow = useCallback(() => {
    if (readOnly) return;
    const newRow: any = { __isNew: true };
    for (const c of columns) {
      if (c === "__isNew") continue;
      newRow[c] = "";
    }
    setRows((prev) => [...prev, newRow]);
    setHasEdits(true);
  }, [columns, readOnly]);

  const tableColumns = useMemo(() => {
    const actionCol = columnHelper.display({
      id: "__actions",
      header: "",
      cell: ({ row }) => {
        const isDeleted = Boolean((row.original as any)?.__deleted);
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleDeleteRow(row.index);
            }}
            title={isDeleted ? "Undo delete" : "Delete row"}
            style={{
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--vscode-errorForeground)",
              padding: "2px 4px",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            <i className={`codicon ${isDeleted ? "codicon-discard" : "codicon-trash"}`} />
          </button>
        );
      },
    });

    const dataCols = columns.map((column) =>
      columnHelper.accessor(column, {
        id: column,
        header: column,
        cell: ({ row, column, getValue }) => {
          const value = getValue();
          const isNew = Boolean((row.original as any)?.__isNew);
          const isDeleted = Boolean((row.original as any)?.__deleted);
          const isAuto = autoCols.has(column.id);
          const isReadonly = readOnly || isDeleted || (pk.has(column.id) && !isNew) || (isNew && isAuto);
          const inputType = columnTypes[column.id];

          if (!isDeleted && isNew && isAuto && (value == null || String(value) === "")) {
            return (
              <div style={{ padding: "4px 8px", color: "var(--vscode-descriptionForeground)", fontStyle: "italic", display: "flex", alignItems: "center", gap: 6 }}>
                <i className="codicon codicon-gear" /> Auto increment
              </div>
            );
          }

          if (isDeleted) {
            return (
              <div style={{ padding: "2px 0", color: "var(--vscode-descriptionForeground)", textDecoration: "line-through", opacity: 0.7 }}>
                {String(value ?? "")}
              </div>
            );
          }

          return renderEditor({
            value,
            rowIndex: row.index,
            columnId: column.id,
            readOnly: isReadonly,
            inputType,
            onEdit: handleCellEdit,
          });
        },
      })
    );

    return showEditingControls ? [actionCol, ...dataCols] : dataCols;
  }, [columns, pk, autoCols, handleCellEdit, toggleDeleteRow, columnTypes, readOnly, showEditingControls]);

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

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

  const commit = useCallback(async () => {
    if (readOnly) return;
    if (rows.length === 0 && editsRef.current.size === 0) return;

    const rowsToKeep: any[] = [];
    let didInsert = false;

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const originalRow = rows[rowIdx];
      const patch = editsRef.current.get(rowIdx) || {};

      if (originalRow?.__deleted) {
        if (originalRow.__isNew) {
          continue;
        }
        const pkObj: Record<string, any> = {};
        const pkCols = Array.from(pk);
        if (pkCols.length) pkCols.forEach(k => pkObj[k] = originalRow[k]);
        else if (columns.length) pkObj[columns[0]] = originalRow[columns[0]];
        vscode.postMessage({ type: "deleteRow", pk: pkObj });
        continue;
      }

      if (originalRow?.__isNew) {
        let rowToInsert: Record<string, any> = { ...originalRow, ...patch };
        delete rowToInsert.__isNew;
        for (const col of autoCols) delete rowToInsert[col];
        rowToInsert = formatRowForBackend(rowToInsert);
        vscode.postMessage({ type: "insertRow", row: rowToInsert });
        didInsert = true;
        rowsToKeep.push(rowToInsert);
        continue;
      }

      if (Object.keys(patch).length > 0) {
        const pkObj: Record<string, any> = {};
        const pkCols = Array.from(pk);
        if (pkCols.length) pkCols.forEach(k => pkObj[k] = originalRow[k]);
        else if (columns.length) pkObj[columns[0]] = originalRow[columns[0]];
        const patchFormatted = formatRowForBackend(patch);
        const updatedRow = { ...originalRow, ...patchFormatted };
        vscode.postMessage({ type: "editRow", pk: pkObj, patch: patchFormatted });
        rowsToKeep.push(updatedRow);
      } else {
        rowsToKeep.push(originalRow);
      }
    }

    setRows(rowsToKeep);
    editsRef.current.clear();
    setHasEdits(false);

    if (didInsert) {
      refresh();
    }
  }, [rows, pk, columns, autoCols, formatRowForBackend, refresh, readOnly]);

  useEffect(() => {
    if (!EXTERNAL_DATA_MODE) fetchPage(0, pageSize);
  }, [fetchPage, pageSize]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", backgroundColor: "var(--vscode-editor-background)", color: "var(--vscode-foreground)" }}>
      <Toolbar
        onRefresh={refresh}
        showEditingControls={showEditingControls}
        onAddRow={addRow}
        onCommit={commit}
        hasEdits={hasEdits}
        columnsCount={columns.length}
        rowsCount={rows.length}
      >
        <PaginationControls
          pageSizeInput={pageSizeInput}
          onChangePageSizeInput={setPageSizeInput}
          onApplyPageSize={applyPageSizeWrapped}
          pageInput={pageInput}
          onChangePageInput={setPageInput}
          onApplyPageNumber={applyPageNumberWrapped}
          offset={offset}
          pageSize={pageSize}
          hasNextPage={hasNextPage}
          loading={loading}
          onPrev={() => goPrev(fetchPage)}
          onNext={() => goNext(fetchPage)}
        />
      </Toolbar>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {error ? (
          <div style={{ padding: 16, color: "var(--vscode-errorForeground)" }}>
            <i className="codicon codicon-error" /> {error}
          </div>
        ) : loading && rows.length === 0 ? (
          <div style={{ padding: 16, opacity: 0.8, fontSize: 12 }}>
            <i className="codicon codicon-sync codicon-modifier-spin" /> Loading...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 16, opacity: 0.8, fontSize: 12 }}>No rows to display.</div>
        ) : (
          <DataTable table={table} />
        )}
      </div>
    </div>
  );
}


