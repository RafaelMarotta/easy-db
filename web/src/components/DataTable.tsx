import React from "react";
import { flexRender, Table } from "@tanstack/react-table";

export interface DataTableProps<T> {
  table: Table<T>;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const { table } = props;
  return (
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
            <tr key={row.id} style={{ backgroundColor: "var(--vscode-editor-background)", borderBottom: "1px solid var(--vscode-panel-border)" }}>
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
  );
}


