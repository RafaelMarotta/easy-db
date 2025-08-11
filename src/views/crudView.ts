import * as vscode from "vscode";
import { DbClient, TableRef } from "../adapters/types";
import { MySqlClient } from "../adapters/mysql";
import { getNonce, sanitizeHtml, resolveWebAssetUris } from "./webviewUtils";

export class CrudViewPanel {
  public static readonly viewType = "easyDb.crud";
  private panels: Map<string, vscode.WebviewPanel> = new Map();

  constructor(private readonly ctx: vscode.ExtensionContext, private readonly getClient: (connectionId: string) => DbClient | null) {}

  open(connectionId: string, ref: TableRef) {
    const key = `${connectionId}:${ref.schema ?? ''}:${ref.name}`;
    const existing = this.panels.get(key);
    if (existing) {
      try { existing.reveal(vscode.ViewColumn.Active, true); } catch {}
      return;
    }

    const panel = vscode.window.createWebviewPanel(CrudViewPanel.viewType, `CRUD: ${ref.name}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.ctx.extensionUri, "media"),
        vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist"),
        vscode.Uri.joinPath(this.ctx.extensionUri, "node_modules", "@vscode", "codicons", "dist")
      ]
    });
    this.panels.set(key, panel);
    const nonce = getNonce();
    const assets = resolveWebAssetUris({ webview: panel.webview, extensionUri: this.ctx.extensionUri });
    const codiconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"));
    panel.webview.html = this.getHtml(panel, assets, codiconUri, panel.webview.cspSource, nonce);
    // forward messages from React app (same contract)
    panel.webview.onDidReceiveMessage(async (msg) => {
      const client = this.getClient(connectionId);
      if (!client) {
        panel.webview.postMessage({ type: "error", id: "crud", message: "Not connected" });
        return;
      }
      try {
        if (msg.type === "fetchPage") {
          const limit = Math.min(Number(msg.pageSize ?? 50), 500);
          // send schema/PK info first
          try {
            const meta = await client.getTableInfo(ref);
            const pkColumns = meta.columns.filter(c => !!c.isPrimaryKey).map(c => c.name);
            const autoColumns = meta.columns.filter(c => !!c.isAutoIncrement).map(c => c.name);
            const dateTimeColumns = meta.columns
              .filter(c => /date|time|timestamp/i.test(c.dataType))
              .map(c => c.name);
            const columnTypes: Record<string, string> = {};
            for (const c of meta.columns) {
              const t = String(c.dataType || "").toLowerCase();
              let cat = "text";
              if (t === "date") cat = "date";
              else if (t.includes("timestamp") || t.includes("datetime")) cat = "datetime";
              else if (t.startsWith("time")) cat = "time";
              else if (/(int|decimal|numeric|real|double|float)/.test(t)) cat = "number";
              else if (t.includes("bool")) cat = "boolean";
              columnTypes[c.name] = cat;
            }
            panel.webview.postMessage({ type: "schema", pkColumns, autoColumns, dateTimeColumns, columnTypes, readOnly: false });
          } catch {
            // ignore meta errors to keep grid usable
            panel.webview.postMessage({ type: "schema", pkColumns: [], readOnly: false });
          }
          const sql = `select * from ${this.qi(ref, client)} limit ${limit} offset ${Number(msg.offset ?? 0)}`;
          let count = 0;
          for await (const chunk of client.runQuery(sql)) {
            count += chunk.rows.length;
            panel.webview.postMessage({ type: "queryChunk", id: "crud", columns: chunk.columns.map(sanitizeHtml), rows: chunk.rows });
          }
          panel.webview.postMessage({ type: "queryDone", id: "crud", rowCount: count, durationMs: 0 });
        } else if (msg.type === "insertRow") {
          const affected = await client.insert(ref, msg.row ?? {});
          panel.webview.postMessage({ type: "mutationDone", affected });
        } else if (msg.type === "editRow") {
          const affected = await client.update(ref, msg.pk ?? {}, msg.patch ?? {});
          panel.webview.postMessage({ type: "mutationDone", affected });
        } else if (msg.type === "deleteRow") {
          const affected = await client.delete(ref, msg.pk ?? {});
          panel.webview.postMessage({ type: "mutationDone", affected });
        }
      } catch (err: any) {
        panel.webview.postMessage({ type: "error", id: msg?.id ?? "crud", message: String(err?.message ?? err) });
      }
    });

    panel.onDidDispose(() => {
      this.panels.delete(key);
    });
  }

  private getHtml(panel: vscode.WebviewPanel, assets: { css: string[]; js: string[] }, codiconUri: vscode.Uri, cspSource: string, nonce: string): string {
    // Fallback to hardcoded assets if manifest resolution fails
    if (assets.css.length === 0 && assets.js.length === 0) {
      const jsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "index-DuM-9hH4.js"));
      const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "index-CUefaaAx.css"));
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${cspSource}; style-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}" nonce="${nonce}" />
  <link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" />
  <title>CRUD</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${jsUri}" nonce="${nonce}"></script>
</body>
</html>`;
    }
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${cspSource}; style-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${assets.css.map(href => `<link rel=\"stylesheet\" href=\"${href}\" nonce=\"${nonce}\" />`).join("\n  ")}
  <link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" />
  <title>CRUD</title>
</head>
<body>
  <div id="root"></div>
  ${assets.js.map(src => `<script type=\"module\" src=\"${src}\"></script>`).join("\n  ")}
</body>
</html>`;
  }

  private qi(ref: TableRef, client: DbClient): string {
    if (client instanceof MySqlClient) {
      const schema = ref.schema ? `\`${ref.schema.replace(/`/g, "``")}\`.` : "";
      const name = `\`${ref.name.replace(/`/g, "``")}\``;
      return `${schema}${name}`;
    }
    const schema = ref.schema ? `"${ref.schema.replace(/\"/g, '""')}".` : "";
    const name = `"${ref.name.replace(/\"/g, '""')}"`;
    return `${schema}${name}`;
  }
}
