import React from "react";

export interface PaginationControlsProps {
  pageSizeInput: string;
  onChangePageSizeInput: (v: string) => void;
  onApplyPageSize: () => void;

  pageInput: string;
  onChangePageInput: (v: string) => void;
  onApplyPageNumber: () => void;

  offset: number;
  pageSize: number;
  hasNextPage: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function PaginationControls(props: PaginationControlsProps) {
  const {
    pageSizeInput,
    onChangePageSizeInput,
    onApplyPageSize,
    pageInput,
    onChangePageInput,
    onApplyPageNumber,
    offset,
    pageSize,
    hasNextPage,
    loading,
    onPrev,
    onNext,
  } = props;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
      <label style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>Rows per page</label>
      <input
        type="number"
        min={1}
        max={500}
        value={pageSizeInput}
        onChange={(e) => onChangePageSizeInput(e.target.value)}
        onBlur={onApplyPageSize}
        onKeyDown={(e) => { if (e.key === 'Enter') onApplyPageSize(); }}
        style={{
          width: 72,
          background: "var(--vscode-input-background)",
          color: "var(--vscode-input-foreground)",
          border: "1px solid var(--vscode-input-border)",
          padding: "3px 6px",
          borderRadius: 3,
        }}
      />
      <span style={{ color: "var(--vscode-descriptionForeground)", fontSize: 12 }}>|</span>
      <label style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>Page</label>
      <input
        type="number"
        min={1}
        value={pageInput}
        onChange={(e) => onChangePageInput(e.target.value)}
        onBlur={onApplyPageNumber}
        onKeyDown={(e) => { if (e.key === 'Enter') onApplyPageNumber(); }}
        style={{
          width: 64,
          background: "var(--vscode-input-background)",
          color: "var(--vscode-input-foreground)",
          border: "1px solid var(--vscode-input-border)",
          padding: "3px 6px",
          borderRadius: 3,
        }}
      />
      <button
        onClick={onPrev}
        disabled={loading || offset === 0}
        title="Previous page"
        style={{ background: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", border: "1px solid var(--vscode-button-secondaryBorder, transparent)", padding: "4px 8px", borderRadius: 3, cursor: offset === 0 ? "not-allowed" : "pointer", opacity: offset === 0 ? 0.6 : 1 }}
      >
        <i className="codicon codicon-chevron-left" />
      </button>
      <button
        onClick={onNext}
        disabled={loading || !hasNextPage}
        title="Next page"
        style={{ background: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", border: "1px solid var(--vscode-button-secondaryBorder, transparent)", padding: "4px 8px", borderRadius: 3, cursor: !hasNextPage ? "not-allowed" : "pointer", opacity: !hasNextPage ? 0.6 : 1 }}
      >
        <i className="codicon codicon-chevron-right" />
      </button>
      <span style={{ color: "var(--vscode-descriptionForeground)", fontSize: 12 }}>
        {/* The parent can compute exact total if available; here we just show current page index */}
        Page {Math.floor(offset / pageSize) + 1}
      </span>
    </div>
  );
}


