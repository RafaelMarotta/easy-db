import * as vscode from "vscode";
import { DbExplorerProvider } from "./explorer";
import { CrudViewPanel } from "./views/crudView";
import { VariablesViewPanel } from "./views/variablesView";
import { ConnectionViewPanel, ConnectionDraft } from "./views/connectionView";
import { ConnectionConfig, DbClient, TableRef } from "./adapters/types";
import { PostgresClient } from "./adapters/postgres";
import { MySqlClient } from "./adapters/mysql";
import { resolveVariables, interpolateString } from "./utils/variables";
import { resolveWebAssetUris, sanitizeHtml, getNonce } from "./views/webviewUtils";

interface StoredConnection extends Omit<ConnectionConfig, "passwordSecretKey"> {
  passwordSecretKey?: string;
  passwordExpr?: string; // supports ${var}
}

export function activate(context: vscode.ExtensionContext) {
  const connections: Map<string, StoredConnection> = new Map();
  const clients: Record<string, DbClient> = {};
  (global as any).__easyDb_clients = clients;
  let currentConnectionId: string | undefined = context.globalState.get<string>("currentConnectionId");
  const docToConnection: Map<string, string> = new Map();

  const explorer = new DbExplorerProvider(
    async () => Array.from(connections.values()).map(c => ({ id: c.id, name: c.name, client: clients[c.id] ?? null })),
    async (id: string) => clients[id] ?? null
  );
  const tree = vscode.window.createTreeView("dbManager.explorer", { treeDataProvider: explorer });
  context.subscriptions.push(tree);
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((d) => {
      try { docToConnection.delete(d.uri.toString()); } catch {}
    })
  );

  const crud = new CrudViewPanel(context, (id) => clients[id] ?? null);
  // Removed separate Query Runner view per user request

  const variablesPanel = new VariablesViewPanel(context);
  const connectionPanel = new ConnectionViewPanel(
    context,
    async (draft) => {
      const id = draft.id || String(Date.now());
      const isExpr = typeof draft.password === "string" && /\$\{[A-Za-z0-9_.-]+\}/.test(draft.password);
      const passwordSecretKey = !isExpr && draft.password ? `conn:${id}:password` : undefined;
      if (draft.password && passwordSecretKey) await context.secrets.store(passwordSecretKey, draft.password);
      const cfg: StoredConnection = {
        id,
        name: draft.name,
        driver: draft.driver,
        host: draft.host,
        port: draft.port,
        database: draft.database,
        user: draft.user,
        passwordSecretKey,
        passwordExpr: isExpr ? draft.password : undefined,
        ssl: draft.ssl,
        ssh: draft.ssh ? { host: draft.ssh.host, user: draft.ssh.user, keyPath: draft.ssh.keyPath, passphraseSecretKey: draft.ssh.passphrase ? `conn:${id}:ssh-pass` : undefined, port: draft.ssh.port } : undefined,
      };
      if (draft.ssh?.passphrase) await context.secrets.store(`conn:${id}:ssh-pass`, draft.ssh.passphrase);
      connections.set(cfg.id, cfg);
      await persistConnections(context, connections);
      explorer.refresh();
    },
    async (draft) => {
      // Test using a transient client with direct password (no secret persistence)
      let password: string | undefined = draft.password;
      if (typeof draft.password === "string" && /\$\{[A-Za-z0-9_.-]+\}/.test(draft.password)) {
        const { values } = await resolveVariables(context);
        password = interpolateString(draft.password, (name) => values.get(name));
      }
      const runtimeCfg: any = {
        id: draft.id || String(Date.now()),
        name: draft.name,
        driver: draft.driver,
        host: draft.host,
        port: draft.port,
        database: draft.database,
        user: draft.user,
        password,
        ssl: draft.ssl,
      };
      try {
        const client: DbClient = draft.driver === "postgres" ? new PostgresClient() : new MySqlClient();
        await client.connect(runtimeCfg);
        await client.disconnect();
        return { ok: true, message: "Success" };
      } catch (e: any) {
        return { ok: false, message: String(e?.message ?? e) };
      }
    }
  );

  async function openConnectionPanelPrefilled(defaults: Partial<ConnectionDraft>) {
    await connectionPanel.open(defaults);
  }

  // Saved queries support
  type SavedQuery = { id: string; name: string; sql: string; connectionId: string; updatedAt: number };
  class SavedQueriesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
      const all = loadSavedQueries();
      if (!element) {
        const byConn = new Map<string, SavedQuery[]>();
        for (const q of all) {
          const list = byConn.get(q.connectionId) ?? [];
          list.push(q);
          byConn.set(q.connectionId, list);
        }
        return Array.from(byConn.entries()).map(([cid]) => {
          const label = connections.get(cid)?.name ?? cid;
          const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
          (item as any).connectionId = cid;
          item.contextValue = "savedQueries.connection";
          item.iconPath = new vscode.ThemeIcon('database');
          return item;
        });
      }
      const cid = (element as any).connectionId as string | undefined;
      if (!cid) return [];
      return loadSavedQueries()
        .filter(q => q.connectionId === cid)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(q => {
          const item = new vscode.TreeItem(q.name, vscode.TreeItemCollapsibleState.None);
          item.description = new Date(q.updatedAt).toLocaleString();
          item.command = { command: 'easyDb.openSavedQuery', title: 'Open', arguments: [q] };
          item.iconPath = new vscode.ThemeIcon('file-code');
          item.contextValue = 'savedQueries.query';
          return item;
        });
    }

    refresh() { this._onDidChangeTreeData.fire(); }
  }

  function loadSavedQueries(): SavedQuery[] {
    return context.globalState.get<SavedQuery[]>("savedQueries", []) ?? [];
  }
  async function saveSavedQueries(list: SavedQuery[]) {
    await context.globalState.update("savedQueries", list);
    queriesTree.refresh();
  }

  const queriesTree = new SavedQueriesProvider();
  const queriesView = vscode.window.createTreeView("dbManager.queries", { treeDataProvider: queriesTree });
  context.subscriptions.push(queriesView);

  // Track query consoles (open SQL docs) per connection
  const consolesByConnection: Map<string, vscode.TextDocument[]> = new Map();
  function indexConsole(doc: vscode.TextDocument, connId: string) {
    const list = consolesByConnection.get(connId) ?? [];
    if (!list.find(d => d.uri.toString() === doc.uri.toString())) list.push(doc);
    consolesByConnection.set(connId, list);
    // auto-save untitled console
    if (doc.isUntitled) {
      (async () => {
        try {
          const folder = vscode.workspace.workspaceFolders?.[0];
          const rel = `console-${Date.now()}.sql`;
          const uri = folder ? vscode.Uri.joinPath(folder.uri, rel) : vscode.Uri.file(require('path').join(require('os').homedir(), rel));
          await vscode.workspace.fs.writeFile(uri, Buffer.from(doc.getText(), 'utf8'));
          const newDoc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(newDoc, { preview: false });
          docToConnection.set(newDoc.uri.toString(), connId);
          indexConsole(newDoc, connId);
          // Do not programmatically close the original untitled model to avoid VS Code
          // "Model is disposed!" errors emitted by other extensions. Let the user close it.
        } catch {}
      })();
    }
  }
  function removeConsole(doc: vscode.TextDocument) {
    for (const [cid, list] of consolesByConnection.entries()) {
      const next = list.filter(d => d.uri.toString() !== doc.uri.toString());
      if (next.length !== list.length) consolesByConnection.set(cid, next);
    }
  }
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(removeConsole));

  function parseTableRef(token: string): TableRef {
    const strip = (s: string) => s.replace(/^[`\"]|[`\"]$/g, "");
    const parts = token.split(".");
    if (parts.length === 2) return { schema: strip(parts[0]), name: strip(parts[1]) };
    return { name: strip(token) } as TableRef;
  }

  function buildSqlTemplate(ref?: { name?: string; schema?: string }, driver?: "postgres" | "mysql"): string {
    if (!ref) return `-- Write your SQL here\nselect 1;\n`;
    if (driver === "mysql") {
      const full = ref.schema ? `\`${String(ref.schema).replace(/`/g, "``")}\`.\`${String(ref.name ?? "").replace(/`/g, "``")}\`` : `\`${String(ref.name ?? "").replace(/`/g, "``")}\``;
      return `-- New query\nselect * from ${full} limit 100;\n`;
    }
    const full = ref.schema ? `"${String(ref.schema).replace(/\"/g, '\\"')}"."${String(ref.name ?? "").replace(/\"/g, '\\"')}"` : `"${String(ref.name ?? "").replace(/\"/g, '\\"')}"`;
    return `-- New query\nselect * from ${full} limit 100;\n`;
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("easyDb.addConnection", async () => {
      await connectionPanel.open();
    }),
    vscode.commands.registerCommand("easyDb.editConnection", async (arg?: any) => {
      let pick = arg && arg.contextData?.connectionId ? connections.get(String(arg.contextData.connectionId)) : undefined;
      if (!pick) pick = await pickConnection(connections);
      if (!pick) return;
      await connectionPanel.open({
        id: pick.id,
        name: pick.name,
        driver: pick.driver,
        host: pick.host,
        port: pick.port,
        database: pick.database,
        user: pick.user,
        password: pick.passwordExpr ? pick.passwordExpr : undefined
      });
    }),
    vscode.commands.registerCommand("easyDb.removeConnection", async (arg?: any) => {
      let pick = arg && arg.contextData?.connectionId ? connections.get(String(arg.contextData.connectionId)) : undefined;
      if (!pick) pick = await pickConnection(connections);
      if (!pick) return;
      const yes = await vscode.window.showWarningMessage(`Remove connection ${pick.name}?`, { modal: true }, "Remove");
      if (yes !== "Remove") return;
      connections.delete(pick.id);
      await context.secrets.delete(`conn:${pick.id}:password`);
      await persistConnections(context, connections);
      explorer.refresh();
    }),
    vscode.commands.registerCommand("easyDb.connect", async (arg?: any) => {
      let pick = arg && typeof arg === 'string' ? connections.get(arg) : undefined;
      if (!pick) pick = await pickConnection(connections);
      if (!pick) return;
      try {
        const client = await createClient(context, pick);
        clients[pick.id] = client;
        vscode.window.setStatusBarMessage(`Connected: ${pick.name}`, 3000);
        currentConnectionId = pick.id;
        await context.globalState.update("currentConnectionId", currentConnectionId);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Connect failed: ${String(e?.message ?? e)}`);
      } finally {
        explorer.refresh();
      }
    }),
    vscode.commands.registerCommand("easyDb.disconnect", async () => {
      const pick = await pickConnection(connections);
      if (!pick) return;
      const c = clients[pick.id];
      if (c) {
        await c.disconnect().catch(() => {});
        delete clients[pick.id];
      }
      explorer.refresh();
      if (currentConnectionId === pick.id) {
        currentConnectionId = undefined;
        await context.globalState.update("currentConnectionId", undefined);
      }
    }),
    vscode.commands.registerCommand("easyDb.refreshExplorer", () => explorer.refresh()),
    vscode.commands.registerCommand("easyDb.openCrud", (connectionId: string, ref) => crud.open(connectionId, ref)),
    vscode.commands.registerCommand("easyDb.newQuery", async (arg?: any) => {
      let connectionId: string | undefined;
      let ref: any;
      if (arg && typeof arg === "object") {
        const ctx = (arg.contextData ?? arg) as any;
        if (ctx.connectionId) connectionId = String(ctx.connectionId);
        if (ctx.ref) ref = ctx.ref;
      }
      if (!connectionId) connectionId = currentConnectionId;
      const driver = connectionId ? connections.get(connectionId)?.driver : undefined;
      const doc = await vscode.workspace.openTextDocument({ content: buildSqlTemplate(ref, driver as any), language: "sql" });
      await vscode.window.showTextDocument(doc, { preview: false });
      if (connectionId) docToConnection.set(doc.uri.toString(), connectionId);
      if (connectionId) indexConsole(doc, connectionId);
    }),
    vscode.commands.registerCommand("easyDb.runQuery", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const sql = editor.selection && !editor.selection.isEmpty ? doc.getText(editor.selection) : doc.getText();
      const connectionId: string | undefined = docToConnection.get(doc.uri.toString()) || currentConnectionId || (await pickConnection(connections))?.id;
      if (!connectionId) return;
      const client = clients[connectionId];
      if (!client) { vscode.window.showErrorMessage("Not connected"); return; }

      // Create results panel with React grid
      const panel = vscode.window.createWebviewPanel("easyDb.queryResults", "Query Results", vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
          vscode.Uri.joinPath(context.extensionUri, "media", "dist"),
          vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist")
        ]
      });
      const assets = resolveWebAssetUris({ webview: panel.webview, extensionUri: context.extensionUri });
      const codiconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"));
      const nonce = getNonce();
      const baseHtml = getReactHtml(panel.webview, assets, codiconUri, nonce);
      panel.webview.html = baseHtml.replace('<div id="root"></div>', `<script nonce="${nonce}">window.__EASYDB_EXTERNAL__=true;</script><div id=\"root\"></div>`);
      const post = (m: any) => panel.webview.postMessage(m);
      post({ type: "init", externalDataMode: true });

      const isSimpleSelectStar = /^\s*select\s+\*\s+from\s+([\w`".]+)(\s+limit\s+\d+)?\s*;?\s*$/i.test(sql);
      if (isSimpleSelectStar) {
        const tableToken = sql.match(/^\s*select\s+\*\s+from\s+([\w`".]+)(?:\s+limit\s+\d+)?\s*;?\s*$/i)![1];
        const ref = parseTableRef(tableToken);
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
          post({ type: "schema", pkColumns, autoColumns, dateTimeColumns, columnTypes, readOnly: false });
        } catch {
          post({ type: "schema", pkColumns: [], readOnly: false });
        }
      } else {
        post({ type: "schema", pkColumns: [], readOnly: true });
      }

      // Listen for ready/refresh and (re)run the query. Keep listener to support repeated refreshes.
      let inFlight = false;
      panel.webview.onDidReceiveMessage(async (m) => {
        if (m?.type !== "ready" && m?.type !== "refresh") return;
        if (inFlight) return;
        inFlight = true;
        try {
          // reset loading state on refresh
          if (m?.type === "refresh") {
            post({ type: "init", externalDataMode: true });
          }
          for await (const chunk of client.runQuery(sql)) {
            post({ type: "queryChunk", id: chunk.id, columns: chunk.columns.map(c => sanitizeHtml(c)), rows: chunk.rows });
          }
          post({ type: "queryDone", id: "run", rowCount: 0, durationMs: 0 });
        } catch (err: any) {
          post({ type: "error", id: "run", message: String(err?.message ?? err) });
        } finally {
          inFlight = false;
        }
      });
    }),
    vscode.commands.registerCommand("easyDb.runLine", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const line = doc.lineAt(editor.selection.active.line);
      const selText = editor.selection && !editor.selection.isEmpty ? doc.getText(editor.selection) : doc.getText(line.range);
      const sql = selText;
      const connectionId: string | undefined = docToConnection.get(doc.uri.toString()) || currentConnectionId || (await pickConnection(connections))?.id;
      if (!connectionId) return;
      const client = clients[connectionId];
      if (!client) { vscode.window.showErrorMessage("Not connected"); return; }

      const panel = vscode.window.createWebviewPanel("easyDb.queryResults", "Query Results", vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
          vscode.Uri.joinPath(context.extensionUri, "media", "dist"),
          vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist")
        ]
      });
      const assets = resolveWebAssetUris({ webview: panel.webview, extensionUri: context.extensionUri });
      const codiconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"));
      const nonce = getNonce();
      const baseHtml = getReactHtml(panel.webview, assets, codiconUri, nonce);
      panel.webview.html = baseHtml.replace('<div id="root"></div>', `<script nonce="${nonce}">window.__EASYDB_EXTERNAL__=true;</script><div id=\"root\"></div>`);
      const post = (m: any) => panel.webview.postMessage(m);
      post({ type: "schema", pkColumns: [], readOnly: true });
      const disposable = panel.webview.onDidReceiveMessage(async (m) => {
        if (m?.type !== "ready") return;
        disposable.dispose();
        try {
          for await (const chunk of client.runQuery(sql)) {
            post({ type: "queryChunk", id: chunk.id, columns: chunk.columns.map(c => sanitizeHtml(c)), rows: chunk.rows });
          }
          post({ type: "queryDone", id: "run", rowCount: 0, durationMs: 0 });
        } catch (err: any) {
          post({ type: "error", id: "run", message: String(err?.message ?? err) });
        }
      });
    }),
    vscode.commands.registerCommand("easyDb.saveQuery", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const sql = doc.getText();
      const connId = (doc as any).easyDbConnectionId || currentConnectionId;
      if (!connId) { vscode.window.showErrorMessage("No connection selected for this query."); return; }
      const name = await vscode.window.showInputBox({ prompt: "Save query as", value: "New Query" });
      if (!name) return;
      const list = loadSavedQueries();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      list.push({ id, name, sql, connectionId: connId, updatedAt: Date.now() });
      await saveSavedQueries(list);
      vscode.window.setStatusBarMessage(`Saved query '${name}'`, 2000);
    }),
    vscode.commands.registerCommand("easyDb.openSavedQuery", async (q: SavedQuery) => {
      const doc = await vscode.workspace.openTextDocument({ content: q.sql, language: 'sql' });
      await vscode.window.showTextDocument(doc, { preview: false });
      docToConnection.set(doc.uri.toString(), q.connectionId);
    }),
    vscode.commands.registerCommand("easyDb.runSavedQuery", async (q: SavedQuery) => {
      const doc = await vscode.workspace.openTextDocument({ content: q.sql, language: 'sql' });
      await vscode.window.showTextDocument(doc, { preview: false });
      docToConnection.set(doc.uri.toString(), q.connectionId);
      await vscode.commands.executeCommand('easyDb.runQuery');
    }),
    vscode.commands.registerCommand("easyDb.manageVariables", () => variablesPanel.open()),
    vscode.commands.registerCommand("easyDb.openConsoles", async () => {
      // Pick a connection first
      const pick = currentConnectionId ? connections.get(currentConnectionId) : await pickConnection(connections);
      if (!pick) return;
      currentConnectionId = pick.id;
      await context.globalState.update("currentConnectionId", currentConnectionId);

      const consoles = consolesByConnection.get(pick.id) ?? [];
      const items = [
        { label: "Open Default Query Console", id: "default" },
        { label: "New Query Console", id: "new" },
        { label: `All Consoles (${consoles.length})`, id: "all" }
      ];
      const choice = await vscode.window.showQuickPick(items, { placeHolder: "Query Consoles" });
      if (!choice) return;
      if (choice.id === "default") {
        // Reuse an existing doc or create new with basic template
        const existing = consoles[0];
        if (existing) {
          await vscode.window.showTextDocument(existing, { preview: false });
        } else {
          const doc = await vscode.workspace.openTextDocument({ content: buildSqlTemplate(undefined, pick.driver), language: 'sql' });
          await vscode.window.showTextDocument(doc, { preview: false });
          docToConnection.set(doc.uri.toString(), pick.id);
          indexConsole(doc, pick.id);
        }
      } else if (choice.id === "new") {
        const doc = await vscode.workspace.openTextDocument({ content: buildSqlTemplate(undefined, pick.driver), language: 'sql' });
        await vscode.window.showTextDocument(doc, { preview: false });
        docToConnection.set(doc.uri.toString(), pick.id);
        indexConsole(doc, pick.id);
      } else if (choice.id === "all") {
        if (consoles.length === 0) {
          vscode.window.showInformationMessage("No query consoles for this connection.");
          return;
        }
        const pickDoc = await vscode.window.showQuickPick(consoles.map(d => ({ label: d.uri.path.split('/').pop() || d.fileName, description: d.uri.toString(), d })), { placeHolder: 'Select a console to open' });
        if (pickDoc?.d) await vscode.window.showTextDocument(pickDoc.d, { preview: false });
      }
    })
  );

  // load stored connections
  loadConnections(context).forEach(c => connections.set(c.id, c));
}

export function deactivate() {}

async function createClient(context: vscode.ExtensionContext, cfg: StoredConnection): Promise<DbClient> {
  let password = cfg.passwordSecretKey ? await context.secrets.get(cfg.passwordSecretKey) : undefined;
  if (!password && cfg.passwordExpr) {
    const { values } = await resolveVariables(context);
    try { password = interpolateString(cfg.passwordExpr, (n) => values.get(n)); } catch { /* will be handled by adapter connect */ }
  }
  const runtimeCfg = { ...cfg } as any;
  if (password) runtimeCfg.password = password;
  let client: DbClient;
  if (cfg.driver === "postgres") client = new PostgresClient();
  else client = new MySqlClient();
  await client.connect(runtimeCfg);
  return client;
}

function loadConnections(context: vscode.ExtensionContext): StoredConnection[] {
  try {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) return [];
    const list = context.globalState.get<StoredConnection[]>("connections", []);
    return list ?? [];
  } catch {
    return [];
  }
}

async function persistConnections(context: vscode.ExtensionContext, map: Map<string, StoredConnection>) {
  await context.globalState.update("connections", Array.from(map.values()));
}

async function pickConnection(connections: Map<string, StoredConnection>): Promise<StoredConnection | undefined> {
  const items = Array.from(connections.values()).map(c => ({ label: c.name, description: c.driver, c }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select connection" });
  return pick?.c;
}

function getReactHtml(webview: vscode.Webview, assets: { css: string[]; js: string[] }, codiconUri: vscode.Uri, nonce: string): string {
  if (assets.css.length === 0 && assets.js.length === 0) {
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath((webview as any).extensionUri ?? ({} as any), "media", "dist", "assets", "index-DuM-9hH4.js"));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath((webview as any).extensionUri ?? ({} as any), "media", "dist", "assets", "index-CUefaaAx.css"));
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};" /><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${cssUri}" nonce="${nonce}" /><link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" /><title>Results</title></head><body><div id="root"></div><script type="module" src="${jsUri}" nonce="${nonce}"></script></body></html>`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};" /><meta name="viewport" content="width=device-width, initial-scale=1.0">${assets.css.map(href => `<link rel="stylesheet" href="${href}" nonce="${nonce}" />`).join("\n  ")}<link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" /><title>Results</title></head><body><div id="root"></div>${assets.js.map(src => `<script type="module" src="${src}"></script>`).join("\n  ")}</body></html>`;
}
