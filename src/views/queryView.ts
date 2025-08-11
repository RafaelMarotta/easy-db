import * as vscode from "vscode";
import { DbClient, TableRef } from "../adapters/types";
import { getNonce, sanitizeHtml, resolveWebAssetUris } from "./webviewUtils";
import { MySqlClient } from "../adapters/mysql";

export class QueryViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "easyDb.queryView";
  private view?: vscode.WebviewView;
  private resultsPanel?: vscode.WebviewPanel;

  constructor(private readonly extensionUri: vscode.Uri, private readonly getClient: (connectionId: string) => DbClient | null) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    const nonce = getNonce();
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media"), vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode", "codicons", "dist"), vscode.Uri.joinPath(this.extensionUri, "media", "dist")]
    };
    const scriptUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "query.js"));
    const styleUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "query.css"));

    webviewView.webview.html = this.getHtml(scriptUri, styleUri, nonce);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg?.type === "runQuery") {
          const client = this.getClient(String(msg.connectionId));
          if (!client) {
            this.post({ type: "error", id: msg.id ?? "run", message: "Not connected" });
            return;
          }

          const sql = String(msg.sql || "");
          const isSimpleSelectStar = /^\s*select\s+\*\s+from\s+([\w`".]+)(\s+limit\s+\d+)?\s*;?\s*$/i.test(sql);

          // Close previous results panel
          try { this.resultsPanel?.dispose(); } catch {}
          this.resultsPanel = vscode.window.createWebviewPanel("easyDb.queryResults", "Query Results", vscode.ViewColumn.Active, {
            enableScripts: true,
            localResourceRoots: [
              vscode.Uri.joinPath(this.extensionUri, "media"),
              vscode.Uri.joinPath(this.extensionUri, "media", "dist"),
              vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode", "codicons", "dist")
            ]
          });

          // Resolve assets AGAINST the results panel webview (critical!)
          const assets = resolveWebAssetUris({ webview: this.resultsPanel.webview, extensionUri: this.extensionUri });
          const codiconUri = this.resultsPanel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"));
          const nonce2 = getNonce();
          this.resultsPanel.webview.html = this.getReactHtml(this.resultsPanel.webview, assets, codiconUri, nonce2);

          const postToGrid = (message: any) => {
            this.resultsPanel?.webview.postMessage(message);
          };

          postToGrid({ type: "init", externalDataMode: true });

          if (isSimpleSelectStar) {
            const tableToken = sql.match(/^\s*select\s+\*\s+from\s+([\w`".]+)(?:\s+limit\s+\d+)?\s*;?\s*$/i)![1];
            const ref = this.parseTableRef(tableToken, client);
            try {
              const meta = await client.getTableInfo(ref);
              const pkColumns = meta.columns.filter(c => !!c.isPrimaryKey).map(c => c.name);
              const autoColumns = meta.columns.filter(c => !!c.isAutoIncrement).map(c => c.name);
              const dateTimeColumns = meta.columns.filter(c => /date|time|timestamp/i.test(c.dataType)).map(c => c.name);
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
              postToGrid({ type: "schema", pkColumns, autoColumns, dateTimeColumns, columnTypes, readOnly: false });
            } catch {
              postToGrid({ type: "schema", pkColumns: [], readOnly: false });
            }
          } else {
            postToGrid({ type: "schema", pkColumns: [], readOnly: true });
          }

          let rows = 0;
          const start = Date.now();
          for await (const chunk of client.runQuery(sql, Array.isArray(msg.params) ? msg.params : [])) {
            rows += chunk.rows.length;
            postToGrid({ type: "queryChunk", id: chunk.id, columns: chunk.columns.map(c => sanitizeHtml(c)), rows: chunk.rows });
          }
          postToGrid({ type: "queryDone", id: msg.id ?? "run", rowCount: rows, durationMs: Date.now() - start });
        }
      } catch (err: any) {
        this.post({ type: "error", id: msg?.id ?? "run", message: String(err?.message ?? err) });
      }
    });
  }

  private parseTableRef(token: string, client: DbClient): TableRef {
    // token may be schema.table with quotes/backticks or just table
    const strip = (s: string) => s.replace(/^[`\"]|[`\"]$/g, "");
    const parts = token.split(".");
    if (parts.length === 2) {
      return { schema: strip(parts[0]), name: strip(parts[1]) };
    }
    return { name: strip(token) } as TableRef;
  }

  private getHtml(scriptUri: vscode.Uri, styleUri: vscode.Uri, nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; font-src ${this.view?.webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}" nonce="${nonce}" />
  <title>Query Runner</title>
</head>
<body>
  <div id="app" aria-label="Query Runner">
    <div class="toolbar">
      <button id="run" aria-label="Run">Run</button>
      <button id="stop" aria-label="Stop">Stop</button>
      <button id="save" aria-label="Save">Save</button>
      <span id="status" role="status"></span>
    </div>
    <textarea id="sql" aria-label="SQL"></textarea>
    <div id="results" role="table" aria-label="Results"></div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getReactHtml(webview: vscode.Webview, assets: { css: string[]; js: string[] }, codiconUri: vscode.Uri, nonce: string): string {
    // Fallback hardcoded assets if manifest resolution fails
    if (assets.css.length === 0 && assets.js.length === 0) {
      const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "dist", "assets", "index-DuM-9hH4.js"));
      const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "dist", "assets", "index-CUefaaAx.css"));
      return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};" /><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${cssUri}" nonce="${nonce}" /><link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" /><title>Results</title></head><body><div id="root"></div><script type="module" src="${jsUri}" nonce="${nonce}"></script></body></html>`;
    }
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};" /><meta name="viewport" content="width=device-width, initial-scale=1.0">${assets.css.map(href => `<link rel="stylesheet" href="${href}" nonce="${nonce}" />`).join("\n  ")}<link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" /><title>Results</title></head><body><div id="root"></div>${assets.js.map(src => `<script type="module" src="${src}"></script>`).join("\n  ")}</body></html>`;
  }

  private post(message: any) {
    this.view?.webview.postMessage(message);
  }
}
