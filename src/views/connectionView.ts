import * as vscode from "vscode";
import { getNonce, sanitizeHtml } from "./webviewUtils";
import { ConnectionConfig } from "../adapters/types";
import { resolveVariables, deleteVariable, saveVariablesBulk, gatherVariables } from "../utils/variables";

export interface ConnectionDraft {
  id: string;
  name: string;
  driver: "postgres" | "mysql";
  host: string;
  port: number;
  database?: string;
  user?: string;
  password?: string; // transient, stored in SecretStorage on save only
  ssl?: { mode: "disable" | "require" | "verify-ca" | "verify-full"; caPath?: string };
  ssh?: { host: string; user: string; keyPath?: string; passphrase?: string; port?: number };
}

export class ConnectionViewPanel {
  public static readonly viewType = "easyDb.connection";
  private panel?: vscode.WebviewPanel;

  constructor(private readonly ctx: vscode.ExtensionContext, private readonly onSave: (draft: ConnectionDraft) => Promise<void>, private readonly onTest: (draft: ConnectionDraft) => Promise<{ ok: boolean; message: string }>) {}

  async open(defaults?: Partial<ConnectionDraft>) {
    const panel = vscode.window.createWebviewPanel(ConnectionViewPanel.viewType, `Create Connection`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")]
    });
    this.panel = panel;
    const nonce = getNonce();
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "connection.js"));
    const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "connection.css"));
    panel.webview.html = this.getHtml(scriptUri, styleUri, nonce);

    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === "variablesPreview") {
          const { maskedPreview } = await resolveVariables(this.ctx);
          this.post({ type: "variablesPreview", masked: Object.fromEntries(maskedPreview.entries()) });
        }
        if (msg.type === "variablesList") {
          const vars = await gatherVariables(this.ctx);
          const items = vars.map(v => ({ id: v.id, value: v.value ?? "" }));
          this.post({ type: "variablesList", items });
        }
        if (msg.type === "variablesBulkSave") {
          await saveVariablesBulk(this.ctx, msg.items || []);
          this.post({ type: "variablesSaved" });
        }
        if (msg.type === "variableDelete") {
          await deleteVariable(this.ctx, String(msg.id));
          this.post({ type: "variableDeleted" });
        }
        if (msg.type === "test") {
          const draft = this.cleanDraft(msg.draft);
          const r = await this.onTest(draft);
          this.post({ type: "testResult", ok: !!r.ok, message: sanitizeHtml(r.message) });
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
      } catch (err: any) {
        this.post({ type: "error", message: String(err?.message ?? err) });
      }
    });

    // initial variables preview and optional defaults
    this.post({ type: "variablesPreview" });
    if (defaults) {
      this.post({ type: "initDefaults", defaults });
    }
  }

  private cleanDraft(raw: any): ConnectionDraft {
    return {
      id: String(raw.id || Date.now()),
      name: String(raw.name || ""),
      driver: raw.driver === "mysql" ? "mysql" : "postgres",
      host: String(raw.host || "localhost"),
      port: Number(raw.port || (raw.driver === "mysql" ? 3306 : 5432)),
      database: raw.database ? String(raw.database) : undefined,
      user: raw.user ? String(raw.user) : undefined,
      password: raw.password ? String(raw.password) : undefined,
      ssl: raw.ssl && raw.ssl.mode && raw.ssl.mode !== "disable" ? { mode: raw.ssl.mode, caPath: raw.ssl.caPath || undefined } : { mode: "disable" },
      ssh: raw.ssh && raw.ssh.host ? { host: String(raw.ssh.host), user: String(raw.ssh.user || ""), keyPath: raw.ssh.keyPath ? String(raw.ssh.keyPath) : undefined, passphrase: raw.ssh.passphrase ? String(raw.ssh.passphrase) : undefined, port: raw.ssh.port ? Number(raw.ssh.port) : undefined } : undefined,
    };
  }

  private getHtml(scriptUri: vscode.Uri, styleUri: vscode.Uri, nonce: string): string {
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
        <label>Driver<select id="driver"><option value="postgres">Postgres</option><option value="mysql">MySQL</option></select></label>
        <label>Host<input id="host" value="localhost" required /></label>
        <label>Port<input id="port" type="number" value="5432" required /></label>
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

  private post(message: any) {
    this.panel?.webview.postMessage(message);
  }
}
