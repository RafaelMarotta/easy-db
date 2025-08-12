import { useCallback, useEffect, useState } from "react";

export function usePagination(initialSize = 100) {
  const [pageSize, setPageSize] = useState<number>(initialSize);
  const [offset, setOffset] = useState<number>(0);
  const [pageSizeInput, setPageSizeInput] = useState<string>(String(initialSize));
  const [pageInput, setPageInput] = useState<string>("1");

  useEffect(() => {
    setPageSizeInput(String(pageSize));
    setPageInput(String(Math.floor(offset / pageSize) + 1));
  }, [pageSize, offset]);

  const applyPageSize = useCallback((apply: (nextOffset: number, nextPageSize: number) => void) => {
    let v = parseInt(pageSizeInput, 10);
    if (Number.isNaN(v)) v = pageSize;
    v = Math.max(1, Math.min(500, v));
    if (v !== pageSize) apply(0, v);
    else setPageSizeInput(String(v));
  }, [pageSizeInput, pageSize]);

  const applyPageNumber = useCallback((apply: (nextOffset: number, nextPageSize: number) => void) => {
    let p = parseInt(pageInput, 10);
    if (Number.isNaN(p)) p = Math.floor(offset / pageSize) + 1;
    p = Math.max(1, p);
    const newOffset = (p - 1) * pageSize;
    if (newOffset !== offset) apply(newOffset, pageSize);
    else setPageInput(String(p));
  }, [pageInput, offset, pageSize]);

  const goPrev = useCallback((apply: (nextOffset: number, nextPageSize: number) => void) => {
    apply(Math.max(0, offset - pageSize), pageSize);
  }, [offset, pageSize]);

  const goNext = useCallback((apply: (nextOffset: number, nextPageSize: number) => void) => {
    apply(offset + pageSize, pageSize);
  }, [offset, pageSize]);

  return {
    pageSize,
    offset,
    setPageSize,
    setOffset,
    pageSizeInput,
    setPageSizeInput,
    pageInput,
    setPageInput,
    applyPageSize,
    applyPageNumber,
    goPrev,
    goNext,
  } as const;
}


