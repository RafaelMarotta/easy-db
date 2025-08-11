import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import "@vscode/codicons/dist/codicon.css";

const vscode: { postMessage: (msg: any) => void } =
  (window as any).acquireVsCodeApi?.() || { postMessage: (_: unknown) => {} };

const EXTERNAL_DATA_MODE: boolean = Boolean((window as any).__EASYDB_EXTERNAL__);

// Helpers
function pad2(n: number): string { return String(n).padStart(2, "0"); }
function isIso8601WithTz(v: string): boolean {
  return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(Z|[+\-]\d{2}:?\d{2})$/i.test(v);
}
function parseIsoOffsetMinutes(v: string): number | null {
  const m = v.match(/(Z|z|([+\-])(\d{2}):?(\d{2}))$/);
  if (!m) return null;
  if ((m[1] || '').toString().toUpperCase() === 'Z') return 0;
  const sign = m[2] === '+' ? 1 : -1;
  const hh = Number(m[3] || '0');
  const mm = Number(m[4] || '0');
  return sign * (hh * 60 + mm);
}
function formatIsoWithOffsetMinutes(dateUtc: Date, offsetMin: number): string {
  const ms = dateUtc.getTime() + offsetMin * 60000;
  const d = new Date(ms);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = pad2(Math.floor(abs / 60));
  const om = pad2(abs % 60);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
         `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}${sign}${oh}:${om}`;
}
function toInputDateTimeLocal(value: string): string {
  // ISO-like -> yyyy-MM-ddTHH:mm:ss
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function parseDateTimeLocalWithOffset(v: string, offsetMin: number): Date | null {
  // v: yyyy-MM-ddTHH:mm[:ss] interpreted as WALL time in the given offset
  const m = v.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/);
  if (!m) return null;
  const [_, ys, ms, ds, hs, mins, ss] = m;
  const y = Number(ys), mo = Number(ms) - 1, d = Number(ds), h = Number(hs), mi = Number(mins), s = Number(ss ?? "0");
  const utcMs = Date.UTC(y, mo, d, h, mi, s) - offsetMin * 60000;
  return new Date(utcMs);
}

// Add back missing hook
function useContainerSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return { ref, ...size } as const;
}

// Editable cell with type-aware inputs
function EditableCell({ 
  value, 
  rowIndex, 
  columnId, 
  isReadonly, 
  onEdit,
  inputType
}: { 
  value: any; 
  rowIndex: number; 
  columnId: string; 
  isReadonly: boolean; 
  onEdit: (rowIndex: number, columnId: string, value: string) => void;
  inputType?: string;
}) {
  const [localValue, setLocalValue] = useState(value == null ? "" : String(value));
  const [errorText, setErrorText] = useState<string>("");
  const [tzOffsetMin, setTzOffsetMin] = useState<number>(() => 0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const v = value == null ? "" : String(value);
    setLocalValue(v);
    setErrorText("");
    const off = parseIsoOffsetMinutes(v);
    if (off !== null) setTzOffsetMin(off);
  }, [value]);

  if (isReadonly) {
    return (
      <div style={{ padding: "4px 8px", color: "var(--vscode-descriptionForeground)" }}>
        {value == null ? "" : String(value)}
      </div>
    );
  }

  const commonStyle: React.CSSProperties = {
    width: "100%",
    background: "transparent",
    border: `1px solid ${errorText ? 'var(--vscode-inputValidation-errorBorder)' : 'transparent'}`,
    color: "var(--vscode-foreground)",
    padding: "4px 8px",
    outline: "none",
    borderRadius: 3,
  };

  const iconButtonStyle: React.CSSProperties = {
    position: 'relative',
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    border: "1px solid var(--vscode-button-border)",
    padding: "4px 8px",
    borderRadius: 3,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginLeft: 6,
    height: 26,
  };

  const onCommit = (val: string) => {
    onEdit(rowIndex, columnId, val);
  };

  // Build timezone options (-12:00 .. +14:00 step 15m)
  const tzOptions = useMemo(() => {
    const opts: Array<{ label: string; value: number }> = [];
    for (let m = -12 * 60; m <= 14 * 60; m += 15) {
      const sign = m >= 0 ? '+' : '-';
      const abs = Math.abs(m);
      const hh = pad2(Math.floor(abs / 60));
      const mm = pad2(abs % 60);
      opts.push({ label: `UTC${sign}${hh}:${mm}`, value: m });
    }
    return opts;
  }, []);

  if (inputType === "datetime") {
    const inputLocal = localValue && isIso8601WithTz(localValue) ? toInputDateTimeLocal(localValue) : "";
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="YYYY-MM-DDTHH:mm:ssZ or ±HH:MM"
          value={localValue}
          onChange={(e) => {
            const v = e.target.value;
            setLocalValue(v);
            setErrorText(v === "" || isIso8601WithTz(v) ? "" : "Invalid ISO 8601 (needs timezone)");
            onEdit(rowIndex, columnId, v);
          }}
          onBlur={() => {
            if (isIso8601WithTz(localValue)) {
              const off = parseIsoOffsetMinutes(localValue);
              if (off !== null) setTzOffsetMin(off);
            }
            onCommit(localValue);
          }}
          style={{ ...commonStyle, flex: 1 }}
        />
        <button type="button" title="Pick date & time" style={iconButtonStyle}>
          <i className="codicon codicon-calendar" />
          <input
            type="datetime-local"
            step={1}
            value={inputLocal}
            onChange={(e) => {
              const raw = e.target.value || ""; // yyyy-MM-ddTHH:mm[:ss]
              if (raw) {
                const dtUtc = parseDateTimeLocalWithOffset(raw, tzOptions.find(o => o.value === tzOffsetMin)?.value ?? 0);
                if (dtUtc) {
                  const iso = formatIsoWithOffsetMinutes(dtUtc, tzOffsetMin);
                  setLocalValue(iso);
                  setErrorText("");
                  onEdit(rowIndex, columnId, iso);
                  inputRef.current?.focus();
                }
              }
            }}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
        </button>
        <select
          value={tzOffsetMin}
          onChange={(e) => {
            const next = Number(e.target.value);
            setTzOffsetMin(next);
            if (localValue && isIso8601WithTz(localValue)) {
              const baseUtc = new Date(localValue); // represents the instant
              if (!Number.isNaN(baseUtc.getTime())) {
                const iso = formatIsoWithOffsetMinutes(baseUtc, next);
                setLocalValue(iso);
                onEdit(rowIndex, columnId, iso);
              }
            }
          }}
          title="Timezone"
          style={{
            background: "var(--vscode-button-secondaryBackground)",
            color: "var(--vscode-button-secondaryForeground)",
            border: "1px solid var(--vscode-button-secondaryBorder, transparent)",
            padding: '3px 6px',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          {tzOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  // Other types handled elsewhere in file (date/number/boolean/text)...
  return (
    <div>
      <input
        ref={inputRef}
        type={inputType === 'time' ? 'time' : inputType === 'number' ? 'number' : 'text'}
        value={localValue}
        onChange={(e) => {
          const v = e.target.value;
          setLocalValue(v);
          if (inputType === 'number') {
            const num = Number(v);
            setErrorText(v !== '' && Number.isNaN(num) ? 'Invalid number' : '');
          } else {
            setErrorText('');
          }
          onEdit(rowIndex, columnId, v);
        }}
        onBlur={() => onCommit(localValue)}
        style={commonStyle}
      />
      {errorText && <div style={{ color: 'var(--vscode-inputValidation-errorForeground)', fontSize: 11, paddingTop: 2 }}>{errorText}</div>}
    </div>
  );
}

export function CrudPage() {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [pk, setPk] = useState<Set<string>>(new Set());
  const [autoCols, setAutoCols] = useState<Set<string>>(new Set());
  const [dateTimeCols, setDateTimeCols] = useState<Set<string>>(new Set());
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(EXTERNAL_DATA_MODE);
  const [error, setError] = useState<string | null>(null);
  const [hasEdits, setHasEdits] = useState<boolean>(false);
  const editsRef = useRef<Map<number, Record<string, any>>>(new Map());
  const { ref: containerRef } = useContainerSize<HTMLDivElement>();

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

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setColumns([]);
    setRows([]);
    setHasEdits(false);
    editsRef.current.clear();
    if ((window as any).__EASYDB_EXTERNAL__) {
      try { vscode.postMessage({ type: "refresh" }); } catch {}
    } else {
      vscode.postMessage({ type: "fetchPage", pageSize: 100, offset: 0 });
    }
  }, []);

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

          return (
            <EditableCell
              value={value}
              rowIndex={row.index}
              columnId={column.id}
              isReadonly={isReadonly}
              onEdit={handleCellEdit}
              inputType={inputType}
            />
          );
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
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[col] = toMySqlDateString(String(v));
      else out[col] = toMySqlDateTimeString(String(v));
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
    const onMessage = (e: MessageEvent<any>) => {
      const msg = e.data;
      if (msg.type === "schema") {
        setPk(new Set(msg.pkColumns || []));
        setAutoCols(new Set(msg.autoColumns || []));
        if (msg.columnTypes) setColumnTypes(msg.columnTypes);
        setDateTimeCols(new Set(msg.dateTimeColumns || []));
        setReadOnly(!!msg.readOnly);
        if (EXTERNAL_DATA_MODE) setLoading(true);
      }
      if (msg.type === "queryChunk") {
        setColumns(msg.columns);
        setRows((prev) => prev.concat(msg.rows));
      }
      if (msg.type === "queryDone") setLoading(false);
      if (msg.type === "error") {
        setLoading(false);
        setError(msg.message);
      }
    };
    window.addEventListener("message", onMessage as any);
    if (!EXTERNAL_DATA_MODE) refresh();
    return () => window.removeEventListener("message", onMessage as any);
  }, [refresh]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", backgroundColor: "var(--vscode-editor-background)", color: "var(--vscode-foreground)" }}>
      <div style={{ padding: "8px 12px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--vscode-panel-border)", backgroundColor: "var(--vscode-toolbar-background)" }}>
        <button onClick={refresh} title="Refresh" style={{ background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)", border: "1px solid var(--vscode-button-border)", padding: "4px 8px", borderRadius: 3, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i className="codicon codicon-refresh" /> Refresh
        </button>
        {showEditingControls && (
          <>
            <button onClick={addRow} title="Add row" disabled={columns.length === 0} style={{ background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)", border: "1px solid var(--vscode-button-border)", padding: "4px 8px", borderRadius: 3, cursor: columns.length === 0 ? "not-allowed" : "pointer", opacity: columns.length === 0 ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i className="codicon codicon-add" /> Add row
            </button>
            <button onClick={commit} title="Commit" disabled={!hasEdits} style={{ background: "var(--vscode-button-background)", color: "var(--vscode-button-foreground)", border: "1px solid var(--vscode-button-border)", padding: "4px 8px", borderRadius: 3, cursor: !hasEdits ? "not-allowed" : "pointer", opacity: !hasEdits ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i className="codicon codicon-check" /> Commit
            </button>
          </>
        )}
        <span style={{ color: "var(--vscode-descriptionForeground)", fontSize: 12, marginLeft: "auto" }}>Columns: {columns.length} · Rows: {rows.length}</span>
      </div>
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
          <div style={{ height: "100%", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "var(--vscode-editor-background)", color: "var(--vscode-foreground)" }}>
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} style={{ backgroundColor: "var(--vscode-editor-background)", borderBottom: "1px solid var(--vscode-panel-border)" }}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        style={{
                          padding: "8px 12px",
                          textAlign: "left",
                          fontWeight: "bold",
                          backgroundColor: "var(--vscode-editor-background)",
                          color: "var(--vscode-foreground)",
                          borderRight: "1px solid var(--vscode-panel-border)",
                          position: "sticky",
                          top: 0,
                          zIndex: 1,
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    style={{
                      backgroundColor: "var(--vscode-editor-background)",
                      borderBottom: "1px solid var(--vscode-panel-border)",
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        style={{
                          padding: "4px 8px",
                          borderRight: "1px solid var(--vscode-panel-border)",
                          backgroundColor: "var(--vscode-editor-background)",
                          color: "var(--vscode-foreground)",
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Existing helpers for MySQL formatting
function toMySqlDateTimeString(isoLike: string): string {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return isoLike;
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}
function toMySqlDateString(isoLike: string): string {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return isoLike;
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}
