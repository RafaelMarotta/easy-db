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
exports.ConnectionViewPanel = void 0;
const vscode = __importStar(require("vscode"));
const webviewUtils_1 = require("./webviewUtils");
const variables_1 = require("../utils/variables");
class ConnectionViewPanel {
    constructor(ctx, onSave, onTest) {
        this.ctx = ctx;
        this.onSave = onSave;
        this.onTest = onTest;
    }
    async open(defaults) {
        const panel = vscode.window.createWebviewPanel(ConnectionViewPanel.viewType, `Create Connection`, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: false,
            localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")]
        });
        this.panel = panel;
        const nonce = (0, webviewUtils_1.getNonce)();
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "connection.js"));
        const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "connection.css"));
        panel.webview.html = this.getHtml(scriptUri, styleUri, nonce);
        panel.webview.onDidReceiveMessage(async (msg) => {
            try {
                if (msg.type === "variablesPreview") {
                    const { maskedPreview } = await (0, variables_1.resolveVariables)(this.ctx);
                    this.post({ type: "variablesPreview", masked: Object.fromEntries(maskedPreview.entries()) });
                }
                if (msg.type === "variablesList") {
                    const vars = await (0, variables_1.gatherVariables)(this.ctx);
                    const items = vars.map(v => ({ id: v.id, value: v.value ?? "" }));
                    this.post({ type: "variablesList", items });
                }
                if (msg.type === "variablesBulkSave") {
                    await (0, variables_1.saveVariablesBulk)(this.ctx, msg.items || []);
                    this.post({ type: "variablesSaved" });
                }
                if (msg.type === "variableDelete") {
                    await (0, variables_1.deleteVariable)(this.ctx, String(msg.id));
                    this.post({ type: "variableDeleted" });
                }
                if (msg.type === "test") {
                    const draft = this.cleanDraft(msg.draft);
                    const r = await this.onTest(draft);
                    this.post({ type: "testResult", ok: !!r.ok, message: (0, webviewUtils_1.sanitizeHtml)(r.message) });
                }
                if (msg.type === "save") {
                    const draft = this.cleanDraft(msg.draft);
                    await this.onSave(draft);
                    this.post({ type: "saved" });
                    panel.dispose();
                }
                if (msg.type === "cancel") {
                    panel.dispose();
                }
            }
            catch (err) {
                this.post({ type: "error", message: String(err?.message ?? err) });
            }
        });
        // initial variables preview and optional defaults
        this.post({ type: "variablesPreview" });
        if (defaults) {
            this.post({ type: "initDefaults", defaults });
        }
    }
    cleanDraft(raw) {
        return {
            id: String(raw.id || Date.now()),
            name: String(raw.name || ""),
            driver: "mysql",
            host: String(raw.host || "localhost"),
            port: Number(raw.port || 3306),
            database: raw.database ? String(raw.database) : undefined,
            user: raw.user ? String(raw.user) : undefined,
            password: raw.password ? String(raw.password) : undefined,
            ssl: raw.ssl && raw.ssl.mode && raw.ssl.mode !== "disable" ? { mode: raw.ssl.mode, caPath: raw.ssl.caPath || undefined } : { mode: "disable" },
            ssh: raw.ssh && raw.ssh.host ? { host: String(raw.ssh.host), user: String(raw.ssh.user || ""), keyPath: raw.ssh.keyPath ? String(raw.ssh.keyPath) : undefined, passphrase: raw.ssh.passphrase ? String(raw.ssh.passphrase) : undefined, port: raw.ssh.port ? Number(raw.ssh.port) : undefined } : undefined,
        };
    }
    getHtml(scriptUri, styleUri, nonce) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}" nonce="${nonce}" />
  <title>Create Connection</title>
</head>
<body>
  <div id="app" class="container" aria-label="Create Connection">
    <h2><span class="icon">🔌</span> New Connection</h2>
    <form id="form" autocomplete="off">
      <input id="connId" type="hidden" />
      <div class="grid">
        <label>Name<input id="name" required /></label>
        <label>Driver<select id="driver"><option value="mysql">MySQL</option></select></label>
        <label>Host<input id="host" value="localhost" required /></label>
        <label>Port<input id="port" type="number" value="3306" required /></label>
        <label>Database<input id="database" /></label>
        <label>User<input id="user" /></label>
        <label>Password
          <div class="input-row">
            <input id="password" type="password" placeholder="plain or ${'{'}varName{'}'}" />
            <button id="togglePw" type="button" aria-label="Show password">Show</button>
          </div>
        </label>
        <label>SSL Mode<select id="sslMode"><option value="disable">Disable</option><option value="require">Require</option><option value="verify-ca">Verify CA</option><option value="verify-full">Verify Full</option></select></label>
        <label>SSL CA Path<input id="sslCa" placeholder="/path/to/ca.pem" /></label>
      </div>
      <details class="ssh">
        <summary>SSH Tunnel (optional)</summary>
        <div class="grid">
          <label>SSH Host<input id="sshHost" /></label>
          <label>SSH User<input id="sshUser" /></label>
          <label>SSH Port<input id="sshPort" type="number" placeholder="22" /></label>
          <label>SSH Key Path<input id="sshKey" placeholder="~/.ssh/id_rsa" /></label>
          <label>SSH Passphrase<input id="sshPass" type="password" /></label>
        </div>
      </details>
      <div class="actions">
        <button id="test" type="button">Test Connection</button>
        <button id="save" type="submit" class="primary">Save</button>
        <button id="cancel" type="button">Cancel</button>
        <span id="status" role="status"></span>
      </div>
      <section class="variables">
        <h3>Variables</h3>
        <div class="vars-toolbar">
          <button id="varAdd" type="button">Add Variable</button>
          <button id="varsSaveAll" type="button" class="primary">Save All</button>
          <span class="muted">Global variables reusable across connections.</span>
        </div>
        <div id="varsList" role="table" aria-label="Variables"></div>
        <div class="preview">Preview: <code id="vars"></code></div>
      </section>
    </form>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
    post(message) {
        this.panel?.webview.postMessage(message);
    }
}
exports.ConnectionViewPanel = ConnectionViewPanel;
ConnectionViewPanel.viewType = "easyDb.connection";
//# sourceMappingURL=connectionView.js.map