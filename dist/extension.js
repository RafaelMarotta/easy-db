"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const explorer_1 = require("./explorer");
const crudView_1 = require("./views/crudView");
const variablesView_1 = require("./views/variablesView");
const connectionView_1 = require("./views/connectionView");
const mysql_1 = require("./adapters/mysql");
const variables_1 = require("./utils/variables");
const webviewUtils_1 = require("./views/webviewUtils");
function activate(context) {
    const connections = new Map();
    const clients = {};
    global.__easyDb_clients = clients;
    let currentConnectionId = context.globalState.get("currentConnectionId");
    const docToConnection = new Map();
    const explorer = new explorer_1.DbExplorerProvider(async () => {
        // Resolve variables for display (e.g., connection name may contain ${var})
        const { values } = await (0, variables_1.resolveVariables)(context);
        const resolveField = (s) => {
            if (!s)
                return "";
            try {
                return (0, variables_1.interpolateString)(s, (n) => values.get(n));
            }
            catch {
                return s;
            }
        };
        return Array.from(connections.values()).map(c => ({ id: c.id, name: resolveField(c.name), client: clients[c.id] ?? null }));
    }, async (id) => clients[id] ?? null);
    const tree = vscode.window.createTreeView("dbManager.explorer", { treeDataProvider: explorer });
    context.subscriptions.push(tree);
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((d) => {
        try {
            docToConnection.delete(d.uri.toString());
        }
        catch { }
    }));
    const crud = new crudView_1.CrudViewPanel(context, (id) => clients[id] ?? null);
    // Removed separate Query Runner view per user request
    const variablesPanel = new variablesView_1.VariablesViewPanel(context);
    const connectionPanel = new connectionView_1.ConnectionViewPanel(context, async (draft) => {
        const id = draft.id || String(Date.now());
        const isExpr = typeof draft.password === "string" && /\$\{[A-Za-z0-9_.-]+\}/.test(draft.password);
        const passwordSecretKey = !isExpr && draft.password ? `conn:${id}:password` : undefined;
        if (draft.password && passwordSecretKey)
            await context.secrets.store(passwordSecretKey, draft.password);
        // Resolve variables for persisted non-secret fields (name/user/host/database) so connection attempts use resolved values,
        // while keeping password as expr when applicable
        const { values } = await (0, variables_1.resolveVariables)(context);
        const safeInterpolate = (s) => {
            if (!s)
                return undefined;
            try {
                return (0, variables_1.interpolateString)(s, (n) => values.get(n));
            }
            catch {
                return s;
            }
        };
        const cfg = {
            id,
            name: safeInterpolate(draft.name) || "",
            driver: draft.driver,
            host: safeInterpolate(draft.host) || draft.host,
            port: draft.port,
            database: safeInterpolate(draft.database),
            user: safeInterpolate(draft.user),
            passwordSecretKey,
            passwordExpr: isExpr ? draft.password : undefined,
            ssl: draft.ssl,
            ssh: draft.ssh ? { host: draft.ssh.host, user: draft.ssh.user, keyPath: draft.ssh.keyPath, passphraseSecretKey: draft.ssh.passphrase ? `conn:${id}:ssh-pass` : undefined, port: draft.ssh.port } : undefined,
        };
        if (draft.ssh?.passphrase)
            await context.secrets.store(`conn:${id}:ssh-pass`, draft.ssh.passphrase);
        connections.set(cfg.id, cfg);
        await persistConnections(context, connections);
        explorer.refresh();
    }, async (draft) => {
        // Test using a transient client with direct password (no secret persistence)
        let password = draft.password;
        if (typeof draft.password === "string" && /\$\{[A-Za-z0-9_.-]+\}/.test(draft.password)) {
            const { values } = await (0, variables_1.resolveVariables)(context);
            password = (0, variables_1.interpolateString)(draft.password, (name) => values.get(name));
        }
        const runtimeCfg = {
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
            const client = new mysql_1.MySqlClient();
            await client.connect(runtimeCfg);
            await client.disconnect();
            return { ok: true, message: "Success" };
        }
        catch (e) {
            return { ok: false, message: String(e?.message ?? e) };
        }
    });
    async function openConnectionPanelPrefilled(defaults) {
        await connectionPanel.open(defaults);
    }
    class SavedQueriesProvider {
        constructor() {
            this._onDidChangeTreeData = new vscode.EventEmitter();
            this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        }
        getTreeItem(element) { return element; }
        async getChildren(element) {
            const all = loadSavedQueries();
            if (!element) {
                const byConn = new Map();
                for (const q of all) {
                    const list = byConn.get(q.connectionId) ?? [];
                    list.push(q);
                    byConn.set(q.connectionId, list);
                }
                return Array.from(byConn.entries()).map(([cid]) => {
                    const label = connections.get(cid)?.name ?? cid;
                    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
                    item.connectionId = cid;
                    item.contextValue = "savedQueries.connection";
                    item.iconPath = new vscode.ThemeIcon('database');
                    return item;
                });
            }
            const cid = element.connectionId;
            if (!cid)
                return [];
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
    function loadSavedQueries() {
        return context.globalState.get("savedQueries", []) ?? [];
    }
    async function saveSavedQueries(list) {
        await context.globalState.update("savedQueries", list);
        queriesTree.refresh();
    }
    const queriesTree = new SavedQueriesProvider();
    const queriesView = vscode.window.createTreeView("dbManager.queries", { treeDataProvider: queriesTree });
    context.subscriptions.push(queriesView);
    // Track query consoles (open SQL docs) per connection
    const consolesByConnection = new Map();
    // Reuse a single results panel per console document
    const resultsPanelByDoc = new Map();
    function sanitizePathSegment(name) {
        const trimmed = name.trim();
        return trimmed.replace(/[\\/:*?"<>|]/g, "_");
    }
    async function getConsolesDir(connId) {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const connName = connections.get(connId)?.name || connId;
        const safeConn = sanitizePathSegment(connName);
        if (folder) {
            const base = vscode.Uri.joinPath(folder.uri, ".vscode", "easy-db", "consoles", safeConn);
            await vscode.workspace.fs.createDirectory(base);
            return base;
        }
        const path = require('path');
        const os = require('os');
        const baseFs = path.join(os.homedir(), ".vscode", "easy-db", "consoles", safeConn);
        const base = vscode.Uri.file(baseFs);
        await vscode.workspace.fs.createDirectory(base);
        return base;
    }
    async function indexConsole(doc, connId) {
        const list = consolesByConnection.get(connId) ?? [];
        if (!list.find(d => d.uri.toString() === doc.uri.toString()))
            list.push(doc);
        consolesByConnection.set(connId, list);
        // auto-save untitled console
        if (doc.isUntitled) {
            (async () => {
                try {
                    const dir = await getConsolesDir(connId);
                    const file = vscode.Uri.joinPath(dir, `console-${Date.now()}.sql`);
                    await vscode.workspace.fs.writeFile(file, Buffer.from(doc.getText(), 'utf8'));
                    const newDoc = await vscode.workspace.openTextDocument(file);
                    await vscode.window.showTextDocument(newDoc, { preview: false });
                    docToConnection.set(newDoc.uri.toString(), connId);
                    await indexConsole(newDoc, connId);
                    // Do not programmatically close the original untitled model to avoid VS Code issues
                }
                catch { }
            })();
        }
    }
    function removeConsole(doc) {
        for (const [cid, list] of consolesByConnection.entries()) {
            const next = list.filter(d => d.uri.toString() !== doc.uri.toString());
            if (next.length !== list.length)
                consolesByConnection.set(cid, next);
        }
    }
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(removeConsole));
    function parseTableRef(token) {
        const strip = (s) => s.replace(/^[`\"]|[`\"]$/g, "");
        const parts = token.split(".");
        if (parts.length === 2)
            return { schema: strip(parts[0]), name: strip(parts[1]) };
        return { name: strip(token) };
    }
    function buildSqlTemplate(ref, driver) {
        if (!ref)
            return `-- Write your SQL here\nselect 1;\n`;
        if (driver === "mysql") {
            const full = ref.schema ? `\`${String(ref.schema).replace(/`/g, "``")}\`.\`${String(ref.name ?? "").replace(/`/g, "``")}\`` : `\`${String(ref.name ?? "").replace(/`/g, "``")}\``;
            return `-- New query\nselect * from ${full} limit 100;\n`;
        }
        // default to mysql quoting
        const full = ref.schema ? `\`${String(ref.schema).replace(/`/g, "``")}\`.\`${String(ref.name ?? "").replace(/`/g, "``")}\`` : `\`${String(ref.name ?? "").replace(/`/g, "``")}\``;
        return `-- New query\nselect * from ${full} limit 100;\n`;
    }
    // Commands
    context.subscriptions.push(vscode.commands.registerCommand("easyDb.addConnection", async () => {
        await connectionPanel.open();
    }), vscode.commands.registerCommand("easyDb.editConnection", async (arg) => {
        let pick = arg && arg.contextData?.connectionId ? connections.get(String(arg.contextData.connectionId)) : undefined;
        if (!pick)
            pick = await pickConnection(connections);
        if (!pick)
            return;
        console.log("Opening connection for edit:", pick);
        // Prepare SSH data, handling passphrase properly
        const sshData = pick.ssh ? {
            host: pick.ssh.host || "",
            user: pick.ssh.user || "",
            keyPath: pick.ssh.keyPath || "",
            passphrase: pick.ssh.passphraseSecretKey ? `\${ssh_passphrase}` : "",
            port: pick.ssh.port || 22
        } : undefined;
        await connectionPanel.open({
            id: pick.id,
            name: pick.name,
            driver: pick.driver,
            host: pick.host,
            port: pick.port,
            database: pick.database,
            user: pick.user,
            password: pick.passwordExpr ? pick.passwordExpr : undefined,
            ssl: pick.ssl,
            ssh: sshData
        });
    }), vscode.commands.registerCommand("easyDb.removeConnection", async (arg) => {
        let pick = arg && arg.contextData?.connectionId ? connections.get(String(arg.contextData.connectionId)) : undefined;
        if (!pick)
            pick = await pickConnection(connections);
        if (!pick)
            return;
        const yes = await vscode.window.showWarningMessage(`Remove connection ${pick.name}?`, { modal: true }, "Remove");
        if (yes !== "Remove")
            return;
        connections.delete(pick.id);
        await context.secrets.delete(`conn:${pick.id}:password`);
        await persistConnections(context, connections);
        explorer.refresh();
    }), vscode.commands.registerCommand("easyDb.connect", async (arg) => {
        let pick = arg && typeof arg === 'string' ? connections.get(arg) : undefined;
        if (!pick)
            pick = await pickConnection(connections);
        if (!pick)
            return;
        try {
            const client = await createClient(context, pick);
            clients[pick.id] = client;
            vscode.window.setStatusBarMessage(`Connected: ${pick.name}`, 3000);
            currentConnectionId = pick.id;
            await context.globalState.update("currentConnectionId", currentConnectionId);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Connect failed: ${String(e?.message ?? e)}`);
        }
        finally {
            explorer.refresh();
        }
    }), vscode.commands.registerCommand("easyDb.disconnect", async () => {
        const pick = await pickConnection(connections);
        if (!pick)
            return;
        const c = clients[pick.id];
        if (c) {
            await c.disconnect().catch(() => { });
            delete clients[pick.id];
        }
        explorer.refresh();
        if (currentConnectionId === pick.id) {
            currentConnectionId = undefined;
            await context.globalState.update("currentConnectionId", undefined);
        }
    }), vscode.commands.registerCommand("easyDb.refreshExplorer", () => explorer.refresh()), vscode.commands.registerCommand("easyDb.openCrud", (connectionId, ref) => crud.open(connectionId, ref)), vscode.commands.registerCommand("easyDb.newQuery", async (arg) => {
        let connectionId;
        let ref;
        if (arg && typeof arg === "object") {
            const ctx = (arg.contextData ?? arg);
            if (ctx.connectionId)
                connectionId = String(ctx.connectionId);
            if (ctx.ref)
                ref = ctx.ref;
        }
        if (!connectionId)
            connectionId = currentConnectionId;
        const driver = connectionId ? connections.get(connectionId)?.driver : undefined;
        const doc = await vscode.workspace.openTextDocument({ content: buildSqlTemplate(ref, driver), language: "sql" });
        await vscode.window.showTextDocument(doc, { preview: false });
        if (connectionId)
            docToConnection.set(doc.uri.toString(), connectionId);
        if (connectionId)
            indexConsole(doc, connectionId);
    }), vscode.commands.registerCommand("easyDb.runQuery", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const doc = editor.document;
        const sql = editor.selection && !editor.selection.isEmpty ? doc.getText(editor.selection) : doc.getText();
        const docKey = doc.uri.toString();
        const connectionId = docToConnection.get(docKey) || currentConnectionId || (await pickConnection(connections))?.id;
        if (!connectionId)
            return;
        const client = clients[connectionId];
        if (!client) {
            vscode.window.showErrorMessage("Not connected");
            return;
        }
        // Ensure a reusable panel exists for this document
        let entry = resultsPanelByDoc.get(docKey);
        if (!entry) {
            const panel = vscode.window.createWebviewPanel("easyDb.queryResults", "Query Results", vscode.ViewColumn.Active, {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, "media"),
                    vscode.Uri.joinPath(context.extensionUri, "media", "dist"),
                    vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist")
                ]
            });
            const assets = (0, webviewUtils_1.resolveWebAssetUris)({ webview: panel.webview, extensionUri: context.extensionUri });
            const codiconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"));
            const nonce = (0, webviewUtils_1.getNonce)();
            const baseHtml = getReactHtml(panel.webview, assets, codiconUri, nonce);
            panel.webview.html = baseHtml.replace('<div id="root"></div>', `<script nonce="${nonce}">window.__EASYDB_EXTERNAL__=true;</script><div id=\"root\"></div>`);
            let resolveReady = null;
            const ready = new Promise((resolve) => { resolveReady = resolve; });
            const readyListener = panel.webview.onDidReceiveMessage((m) => {
                if (m?.type === "ready") {
                    resolveReady?.();
                }
            });
            panel.onDidDispose(() => {
                readyListener.dispose();
                resultsPanelByDoc.delete(docKey);
            });
            entry = { panel, ready, resolveReady, inFlight: false, latestSql: sql, pendingSql: null };
            resultsPanelByDoc.set(docKey, entry);
            // Attach a single listener to handle refresh messages from the webview
            panel.webview.onDidReceiveMessage(async (m) => {
                if (m?.type === "ready") {
                    entry.resolveReady?.();
                    return;
                }
                if (m?.type === "refresh") {
                    // Re-run the last SQL
                    if (entry.inFlight) {
                        entry.pendingSql = entry.latestSql;
                    }
                    else {
                        const incomingReqId = typeof m.reqId === 'string' ? m.reqId : undefined;
                        void runSql(entry, client, incomingReqId);
                    }
                }
            });
        }
        else {
            try {
                entry.panel.reveal(vscode.ViewColumn.Active, false);
            }
            catch { }
        }
        const post = (m) => entry.panel.webview.postMessage(m);
        // Wait for first load
        await entry.ready.catch(() => { });
        entry.latestSql = sql;
        if (entry.inFlight) {
            // Queue this run; do not reset the UI now to avoid a stuck loading state
            entry.pendingSql = sql;
        }
        else {
            void runSql(entry, client);
        }
    }), vscode.commands.registerCommand("easyDb.runLine", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const doc = editor.document;
        const docKey = doc.uri.toString();
        const line = doc.lineAt(editor.selection.active.line);
        const sql = editor.selection && !editor.selection.isEmpty ? doc.getText(editor.selection) : doc.getText(line.range);
        const connectionId = docToConnection.get(docKey) || currentConnectionId || (await pickConnection(connections))?.id;
        if (!connectionId)
            return;
        const client = clients[connectionId];
        if (!client) {
            vscode.window.showErrorMessage("Not connected");
            return;
        }
        // Reuse same mechanism as runQuery (will read current editor selection/text)
        await vscode.commands.executeCommand("easyDb.runQuery");
    }), vscode.commands.registerCommand("easyDb.saveQuery", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const doc = editor.document;
        const sql = doc.getText();
        const connId = doc.easyDbConnectionId || currentConnectionId;
        if (!connId) {
            vscode.window.showErrorMessage("No connection selected for this query.");
            return;
        }
        const name = await vscode.window.showInputBox({ prompt: "Save query as", value: "New Query" });
        if (!name)
            return;
        const list = loadSavedQueries();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        list.push({ id, name, sql, connectionId: connId, updatedAt: Date.now() });
        await saveSavedQueries(list);
        vscode.window.setStatusBarMessage(`Saved query '${name}'`, 2000);
    }), vscode.commands.registerCommand("easyDb.openSavedQuery", async (q) => {
        const doc = await vscode.workspace.openTextDocument({ content: q.sql, language: 'sql' });
        await vscode.window.showTextDocument(doc, { preview: false });
        docToConnection.set(doc.uri.toString(), q.connectionId);
    }), vscode.commands.registerCommand("easyDb.runSavedQuery", async (q) => {
        const doc = await vscode.workspace.openTextDocument({ content: q.sql, language: 'sql' });
        await vscode.window.showTextDocument(doc, { preview: false });
        docToConnection.set(doc.uri.toString(), q.connectionId);
        await vscode.commands.executeCommand('easyDb.runQuery');
    }), vscode.commands.registerCommand("easyDb.manageVariables", () => variablesPanel.open()), vscode.commands.registerCommand("easyDb.openConsoles", async () => {
        // Pick a connection first
        const pick = currentConnectionId ? connections.get(currentConnectionId) : await pickConnection(connections);
        if (!pick)
            return;
        currentConnectionId = pick.id;
        await context.globalState.update("currentConnectionId", currentConnectionId);
        const consoles = consolesByConnection.get(pick.id) ?? [];
        const items = [
            { label: "Open Default Query Console", id: "default" },
            { label: "New Query Console", id: "new" },
            { label: `All Consoles (${consoles.length})`, id: "all" }
        ];
        const choice = await vscode.window.showQuickPick(items, { placeHolder: "Query Consoles" });
        if (!choice)
            return;
        if (choice.id === "default") {
            // Open or create the default console file at .vscode/easy-db/consoles/{connection_name}/default_console.sql
            const dir = await getConsolesDir(pick.id);
            const defaultUri = vscode.Uri.joinPath(dir, "default_console.sql");
            try {
                await vscode.workspace.fs.stat(defaultUri);
            }
            catch {
                const content = Buffer.from(buildSqlTemplate(undefined, pick.driver), 'utf8');
                await vscode.workspace.fs.writeFile(defaultUri, content);
            }
            const doc = await vscode.workspace.openTextDocument(defaultUri);
            await vscode.window.showTextDocument(doc, { preview: false });
            docToConnection.set(doc.uri.toString(), pick.id);
            await indexConsole(doc, pick.id);
        }
        else if (choice.id === "new") {
            const dir = await getConsolesDir(pick.id);
            const file = vscode.Uri.joinPath(dir, `console-${Date.now()}.sql`);
            const content = Buffer.from(buildSqlTemplate(undefined, pick.driver), 'utf8');
            await vscode.workspace.fs.writeFile(file, content);
            const doc = await vscode.workspace.openTextDocument(file);
            await vscode.window.showTextDocument(doc, { preview: false });
            docToConnection.set(doc.uri.toString(), pick.id);
            await indexConsole(doc, pick.id);
        }
        else if (choice.id === "all") {
            if (consoles.length === 0) {
                vscode.window.showInformationMessage("No query consoles for this connection.");
                return;
            }
            const pickDoc = await vscode.window.showQuickPick(consoles.map(d => ({ label: d.uri.path.split('/').pop() || d.fileName, description: d.uri.toString(), d })), { placeHolder: 'Select a console to open' });
            if (pickDoc?.d)
                await vscode.window.showTextDocument(pickDoc.d, { preview: false });
        }
    }));
    // load stored connections
    loadConnections(context).forEach(c => connections.set(c.id, c));
}
function deactivate() { }
async function createClient(context, cfg) {
    let password = cfg.passwordSecretKey ? await context.secrets.get(cfg.passwordSecretKey) : undefined;
    if (!password && cfg.passwordExpr) {
        const { values } = await (0, variables_1.resolveVariables)(context);
        try {
            password = (0, variables_1.interpolateString)(cfg.passwordExpr, (n) => values.get(n));
        }
        catch { /* will be handled by adapter connect */ }
    }
    const runtimeCfg = { ...cfg };
    if (password)
        runtimeCfg.password = password;
    const client = new mysql_1.MySqlClient();
    await client.connect(runtimeCfg);
    return client;
}
function loadConnections(context) {
    try {
        const wsFolder = vscode.workspace.workspaceFolders?.[0];
        if (!wsFolder)
            return [];
        const list = context.globalState.get("connections", []);
        return list ?? [];
    }
    catch {
        return [];
    }
}
async function persistConnections(context, map) {
    await context.globalState.update("connections", Array.from(map.values()));
}
async function pickConnection(connections) {
    const items = Array.from(connections.values()).map(c => ({ label: c.name, description: c.driver, c }));
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select connection" });
    return pick?.c;
}
function getReactHtml(webview, assets, codiconUri, nonce) {
    if (assets.css.length === 0 && assets.js.length === 0) {
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(webview.extensionUri ?? {}, "media", "dist", "assets", "index-DuM-9hH4.js"));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(webview.extensionUri ?? {}, "media", "dist", "assets", "index-CUefaaAx.css"));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};" /><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${cssUri}" nonce="${nonce}" /><link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" /><title>Results</title></head><body><div id="root"></div><script type="module" src="${jsUri}" nonce="${nonce}"></script></body></html>`;
    }
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource};" /><meta name="viewport" content="width=device-width, initial-scale=1.0">${assets.css.map(href => `<link rel="stylesheet" href="${href}" nonce="${nonce}" />`).join("\n  ")}<link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" /><title>Results</title></head><body><div id="root"></div>${assets.js.map(src => `<script type="module" src="${src}"></script>`).join("\n  ")}</body></html>`;
}
async function runSql(entry, client, reuseReqId) {
    const post = (m) => entry.panel.webview.postMessage(m);
    // Reset view and send schema hint based on latestSql
    post({ type: "init", externalDataMode: true });
    const sql = entry.latestSql;
    const reqId = reuseReqId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
        // Best-effort schema hint for select * from x
        const isSimpleSelectStar = /^\s*select\s+\*\s+from\s+([\w`".]+)(\s+limit\s+\d+)?\s*;?\s*$/i.test(sql);
        if (isSimpleSelectStar) {
            // We cannot access parseTableRef here without circular imports; duplicate minimal logic
            const token = sql.match(/^\s*select\s+\*\s+from\s+([\w`".]+)(?:\s+limit\s+\d+)?\s*;?\s*$/i)[1];
            const strip = (s) => s.replace(/^[`\"]|[`\"]$/g, "");
            const parts = token.split(".");
            const ref = (parts.length === 2) ? { schema: strip(parts[0]), name: strip(parts[1]) } : { name: strip(token) };
            try {
                const meta = await client.getTableInfo(ref);
                const pkColumns = meta.columns.filter((c) => !!c.isPrimaryKey).map((c) => c.name);
                const autoColumns = meta.columns.filter((c) => !!c.isAutoIncrement).map((c) => c.name);
                const dateTimeColumns = meta.columns.filter((c) => /date|time|timestamp/i.test(c.dataType)).map((c) => c.name);
                const columnTypes = {};
                for (const c of meta.columns) {
                    const t = String(c.dataType || "").toLowerCase();
                    let cat = "text";
                    if (t === "date")
                        cat = "date";
                    else if (t.includes("timestamp") || t.includes("datetime"))
                        cat = "datetime";
                    else if (t.startsWith("time"))
                        cat = "time";
                    else if (/(int|decimal|numeric|real|double|float)/.test(t))
                        cat = "number";
                    else if (t.includes("bool"))
                        cat = "boolean";
                    columnTypes[c.name] = cat;
                }
                post({ type: "schema", pkColumns, autoColumns, dateTimeColumns, columnTypes, readOnly: false, reqId });
            }
            catch {
                post({ type: "schema", pkColumns: [], readOnly: false, reqId });
            }
        }
        else {
            post({ type: "schema", pkColumns: [], readOnly: true, reqId });
        }
        entry.inFlight = true;
        for await (const chunk of client.runQuery(sql)) {
            post({ type: "queryChunk", id: chunk.id, columns: (chunk.columns || []).map((c) => (0, webviewUtils_1.sanitizeHtml)(c)), rows: chunk.rows, reqId });
        }
        post({ type: "queryDone", id: "run", rowCount: 0, durationMs: 0, reqId });
    }
    catch (err) {
        // Also show a VS Code notification to surface errors clearly
        try {
            vscode.window.showErrorMessage(`Query failed: ${String(err?.message ?? err)}`);
        }
        catch { }
        post({ type: "error", id: "run", message: String(err?.message ?? err), reqId });
    }
    finally {
        entry.inFlight = false;
        if (entry.pendingSql) {
            // Run the latest queued SQL
            entry.latestSql = entry.pendingSql;
            entry.pendingSql = null;
            void runSql(entry, client);
        }
    }
}
//# sourceMappingURL=extension.js.map