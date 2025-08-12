import { useCallback, useEffect, useRef, useState } from "react";

export interface MessageBus {
  post: (m: any) => void;
  subscribe: (fn: (m: any) => void) => () => void;
}

export function useCrudMessaging(bus: MessageBus) {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState<boolean>(false);
  const [pk, setPk] = useState<Set<string>>(new Set());
  const [autoCols, setAutoCols] = useState<Set<string>>(new Set());
  const [dateTimeCols, setDateTimeCols] = useState<Set<string>>(new Set());
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const currentReqIdRef = useRef<string>("");
  const startedRef = useRef<string>("");

  const sendFetch = useCallback((pageSize: number, offset: number) => {
    setLoading(true);
    setError(null);
    setRows([]);
    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentReqIdRef.current = reqId;
    bus.post({ type: "fetchPage", pageSize, offset, reqId });
  }, [bus]);

  useEffect(() => {
    const unsub = bus.subscribe((msg: any) => {
      if (msg.type === "schema") {
        if (msg.reqId && !currentReqIdRef.current) currentReqIdRef.current = msg.reqId;
        if (msg.reqId && currentReqIdRef.current && msg.reqId !== currentReqIdRef.current) return;
        setLoading(true);
        // optional fields depend on backend
        if (Array.isArray(msg.pkColumns)) setPk(new Set(msg.pkColumns));
        if (Array.isArray(msg.autoColumns)) setAutoCols(new Set(msg.autoColumns));
        if (Array.isArray(msg.dateTimeColumns)) setDateTimeCols(new Set(msg.dateTimeColumns));
        if (msg.columnTypes) setColumnTypes(msg.columnTypes);
        if (typeof msg.readOnly === 'boolean') setReadOnly(!!msg.readOnly);
      }
      if (msg.type === "queryChunk") {
        if (msg.reqId && !currentReqIdRef.current) currentReqIdRef.current = msg.reqId;
        if (msg.reqId && currentReqIdRef.current && msg.reqId !== currentReqIdRef.current) return;
        if (startedRef.current !== currentReqIdRef.current) {
          startedRef.current = currentReqIdRef.current;
          setRows([]);
        }
        setColumns(msg.columns);
        setRows(prev => prev.concat(msg.rows));
      }
      if (msg.type === "queryDone") {
        if (msg.reqId && currentReqIdRef.current && msg.reqId !== currentReqIdRef.current) return;
        setLoading(false);
        if (typeof msg.hasNext === 'boolean') setHasNextPage(!!msg.hasNext);
        startedRef.current = "";
        currentReqIdRef.current = "";
      }
      if (msg.type === "error") {
        if (msg.reqId && currentReqIdRef.current && msg.reqId !== currentReqIdRef.current) return;
        setLoading(false);
        setError(String(msg.message ?? "Error"));
        startedRef.current = "";
        currentReqIdRef.current = "";
      }
    });
    return unsub;
  }, [bus]);

  return {
    columns,
    rows,
    setRows,
    loading,
    error,
    setError,
    sendFetch,
    hasNextPage,
    pk,
    autoCols,
    dateTimeCols,
    columnTypes,
    readOnly,
  } as const;
}


