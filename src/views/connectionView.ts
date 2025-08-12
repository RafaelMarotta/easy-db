import * as vscode from "vscode";
import { getNonce, sanitizeHtml, resolveWebAssetUris } from "./webviewUtils";
import { ConnectionConfig } from "../adapters/types";
import { resolveVariables, deleteVariable, saveVariablesBulk, gatherVariables, interpolateString } from "../utils/variables";

export interface ConnectionDraft {
  id: string;
  name: string;
  driver: "mysql";
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
  private initialDefaults?: Partial<ConnectionDraft>;

  constructor(private readonly ctx: vscode.ExtensionContext, private readonly onSave: (draft: ConnectionDraft) => Promise<void>, private readonly onTest: (draft: ConnectionDraft) => Promise<{ ok: boolean; message: string }>) {}

  async open(defaults?: Partial<ConnectionDraft>) {
    const panel = vscode.window.createWebviewPanel(ConnectionViewPanel.viewType, `Create Connection`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [
        vscode.Uri.joinPath(this.ctx.extensionUri, "media"),
        vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist"),
        vscode.Uri.joinPath(this.ctx.extensionUri, "node_modules", "@vscode", "codicons", "dist")
      ]
    });
    this.panel = panel;
    this.initialDefaults = defaults;
    const nonce = getNonce();
    const assets = resolveWebAssetUris({ webview: panel.webview, extensionUri: this.ctx.extensionUri });
    const codiconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"));
    panel.webview.html = this.getHtml(panel, assets, codiconUri, panel.webview.cspSource, nonce);

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
        if (msg.type === "openVariables") {
          try {
            await vscode.commands.executeCommand("easyDb.manageVariables");
          } catch (err) {
            this.post({ type: "error", message: String((err as any)?.message ?? err) });
          }
        }
        if (msg.type === "requestDefaults") {
          if (this.initialDefaults) {
            this.post({ type: "initDefaults", defaults: this.initialDefaults });
          }
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
          const resolvedDraft = await this.resolveDraftVariables(draft);
          console.log("Testing connection with resolved variables:", { original: draft, resolved: resolvedDraft });
          const r = await this.onTest(resolvedDraft);
          this.post({ type: "testResult", ok: !!r.ok, message: sanitizeHtml(r.message) });
        }
        if (msg.type === "save") {
          const draft = this.cleanDraft(msg.draft);
          console.log("Saving connection with variable syntax preserved:", draft);
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
    setTimeout(() => {
      this.post({ type: "variablesPreview" });
      if (this.initialDefaults) {
        this.post({ type: "initDefaults", defaults: this.initialDefaults });
      }
    }, 100);
  }

  private cleanDraft(raw: any): ConnectionDraft {
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

  private async resolveDraftVariables(draft: ConnectionDraft): Promise<ConnectionDraft> {
    const { values } = await resolveVariables(this.ctx);
    const resolver = (name: string) => values.get(name);

    const resolveField = (field: string | undefined): string | undefined => {
      if (!field) return field;
      try {
        return interpolateString(field, resolver);
      } catch (err) {
        console.warn(`Failed to resolve variables in field: ${field}`, err);
        return field; // Return original if resolution fails
      }
    };

    return {
      ...draft,
      host: resolveField(draft.host) || draft.host,
      database: resolveField(draft.database),
      user: resolveField(draft.user),
      password: resolveField(draft.password),
      ssl: draft.ssl ? {
        ...draft.ssl,
        caPath: resolveField(draft.ssl.caPath)
      } : draft.ssl,
      ssh: draft.ssh ? {
        ...draft.ssh,
        host: resolveField(draft.ssh.host) || draft.ssh.host,
        user: resolveField(draft.ssh.user) || draft.ssh.user,
        keyPath: resolveField(draft.ssh.keyPath),
        passphrase: resolveField(draft.ssh.passphrase)
      } : draft.ssh
    };
  }

  private getHtml(panel: vscode.WebviewPanel, assets: { css: string[]; js: string[] }, codiconUri: vscode.Uri, cspSource: string, nonce: string): string {
    // Use connection-specific assets from the manifest
    const connectionAssets = this.resolveConnectionAssets(panel.webview);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${cspSource}; style-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${connectionAssets.css.map(href => `<link rel=\"stylesheet\" href=\"${href}\" nonce=\"${nonce}\" />`).join("\n  ")}
  <link rel="stylesheet" href="${codiconUri}" nonce="${nonce}" />
  <title>Create Connection</title>
</head>
<body>
  <div id="root"></div>
  ${connectionAssets.js.map(src => `<script type="module" src=\"${src}\" nonce=\"${nonce}\"></script>`).join("\n  ")}
</body>
</html>`;
  }

  private resolveConnectionAssets(webview: vscode.Webview): { css: string[]; js: string[] } {
    const vscode = require('vscode') as typeof import('vscode');
    const manifestPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'dist', '.vite', 'manifest.json');
    
    try {
      const data = require(manifestPath.fsPath);
      const entry = data['connection.html'];
      const jsFiles: string[] = [];
      const cssFiles: string[] = [];
      
      const pushAsset = (p: string) => {
        const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'dist', p));
        const s = assetUri.toString();
        if (p.endsWith('.js')) jsFiles.push(s); 
        else if (p.endsWith('.css')) cssFiles.push(s);
      };
      
      // Add the main entry file
      if (entry?.file) pushAsset(entry.file);
      
      // Add CSS files from the entry
      if (Array.isArray(entry?.css)) {
        entry.css.forEach((p: string) => pushAsset(p));
      }
      
      // Add imports (like codicon)
      if (Array.isArray(entry?.imports)) {
        entry.imports.forEach((importKey: string) => {
          const importEntry = data[importKey];
          if (importEntry?.file) pushAsset(importEntry.file);
          if (Array.isArray(importEntry?.css)) {
            importEntry.css.forEach((p: string) => pushAsset(p));
          }
        });
      }
      
      return { css: cssFiles, js: jsFiles };
    } catch (err) {
      console.warn('Failed to resolve connection assets from manifest, using fallback', err);
      // Fallback to hardcoded connection assets based on the actual manifest structure
      const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "connection-mTRQc80m.js"));
      const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "codicon-CUefaaAx.css"));
      const codiconJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "codicon-CWFHOcLG.js"));
      return { 
        css: [cssUri.toString()], 
        js: [codiconJsUri.toString(), jsUri.toString()]
      };
    }
  }

  private post(message: any) {
    this.panel?.webview.postMessage(message);
  }
}
