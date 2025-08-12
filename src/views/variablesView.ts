import * as vscode from "vscode";
import { Variable, VariableScope } from "../adapters/types";
import { getNonce, sanitizeHtml, resolveWebAssetUris } from "./webviewUtils";
import { gatherVariables, saveVariablesBulk, deleteVariable } from "../utils/variables";

export class VariablesViewPanel {
  public static readonly viewType = "easyDb.variables";
  private panel?: vscode.WebviewPanel;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  open() {
    const panel = vscode.window.createWebviewPanel(VariablesViewPanel.viewType, `Variables`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.ctx.extensionUri, "media"),
        vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist"),
        vscode.Uri.joinPath(this.ctx.extensionUri, "node_modules", "@vscode", "codicons", "dist")
      ]
    });
    this.panel = panel;
    const nonce = getNonce();
    // Find variables.html entry from manifest (fallback handled below)
    const manifest = require(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", ".vite", "manifest.json").fsPath);
    const variablesEntry = manifest["variables.html"];
    const js: string[] = [];
    const css: string[] = [];
    const push = (p: string) => {
      const u = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", p)).toString();
      if (p.endsWith(".js")) js.push(u); else if (p.endsWith(".css")) css.push(u);
    };
    if (variablesEntry?.file) push(variablesEntry.file);
    if (Array.isArray(variablesEntry?.css)) variablesEntry.css.forEach(push);
    const codiconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"));
    if (js.length === 0) {
      // Fallback to hardcoded assets if manifest lookup fails
      const jsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "variables-DcU114Qf.js")).toString();
      const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "codicon-CUefaaAx.css")).toString();
      panel.webview.html = this.getHtml([jsUri], [codiconUri.toString(), cssUri], nonce, panel.webview.cspSource);
    } else {
      panel.webview.html = this.getHtml(js, [codiconUri.toString(), ...css], nonce, panel.webview.cspSource);
    }

    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === "variablesList") {
          const vars = await gatherVariables(this.ctx);
          const items = vars.map(v => ({ id: v.id, value: v.value ?? "" }));
          this.post({ type: "variablesList", items });
        } else if (msg.type === "variablesBulkSave") {
          await saveVariablesBulk(this.ctx, msg.items || []);
          this.post({ type: "variablesSaved" });
        } else if (msg.type === "variableDelete") {
          await deleteVariable(this.ctx, String(msg.id));
          this.post({ type: "variableDeleted" });
        }
      } catch (err: any) {
        this.post({ type: "error", message: String(err?.message ?? err) });
      }
    });
  }

  private getHtml(jsUris: string[], cssUris: string[], nonce: string, cspSource: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}' ${cspSource}; style-src 'nonce-${nonce}' ${cspSource}; font-src ${cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${cssUris.map(h => `<link rel="stylesheet" href="${h}" nonce="${nonce}" />`).join("\n  ")}
  <title>Variables</title>
</head>
<body>
  <div id="root"></div>
  ${jsUris.map(s => `<script type="module" nonce="${nonce}" src="${s}"></script>`).join("\n  ")}
</body>
</html>`;
  }

  private async loadVariables(): Promise<Variable[]> {
    const ws = this.ctx.workspaceState.get<Variable[]>("variables", []);
    const gs = this.ctx.globalState.get<Variable[]>("variables", []);
    return [...(ws ?? []), ...(gs ?? [])];
  }

  private async saveVariable(v: Variable): Promise<void> {
    const target = v.scope === "workspace" ? this.ctx.workspaceState : this.ctx.globalState;
    const list = target.get<Variable[]>("variables", []);
    const next = (list ?? []).filter(x => x.id !== v.id).concat([{ ...v, value: v.isSecret ? undefined : (v.value ?? "") }]);
    await target.update("variables", next);
    if (v.isSecret && v.value) {
      await this.ctx.secrets.store(`var:${v.id}`, v.value);
    }
  }

  private async deleteVariable(id: string): Promise<void> {
    const ws = this.ctx.workspaceState.get<Variable[]>("variables", []);
    const gs = this.ctx.globalState.get<Variable[]>("variables", []);
    await this.ctx.workspaceState.update("variables", (ws ?? []).filter(v => v.id !== id));
    await this.ctx.globalState.update("variables", (gs ?? []).filter(v => v.id !== id));
    await this.ctx.secrets.delete(`var:${id}`);
  }

  private post(message: any) {
    this.panel?.webview.postMessage(message);
  }
}
