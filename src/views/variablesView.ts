import * as vscode from "vscode";
import { Variable, VariableScope } from "../adapters/types";
import { getNonce, sanitizeHtml } from "./webviewUtils";

export class VariablesViewPanel {
  public static readonly viewType = "easyDb.variables";
  private panel?: vscode.WebviewPanel;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  open() {
    const panel = vscode.window.createWebviewPanel(VariablesViewPanel.viewType, `Variables`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")]
    });
    this.panel = panel;
    const nonce = getNonce();
    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "variables.js"));
    const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "variables.css"));
    panel.webview.html = this.getHtml(scriptUri, styleUri, nonce);

    panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.type === "list") {
          const all = await this.loadVariables();
          this.post({ type: "variables", items: all.map(v => ({ ...v, value: v.isSecret ? undefined : v.value })) });
        } else if (msg.type === "save") {
          await this.saveVariable(msg.variable as Variable);
          this.post({ type: "saved" });
        } else if (msg.type === "delete") {
          await this.deleteVariable(String(msg.id));
          this.post({ type: "deleted" });
        }
      } catch (err: any) {
        this.post({ type: "error", message: String(err?.message ?? err) });
      }
    });
  }

  private getHtml(scriptUri: vscode.Uri, styleUri: vscode.Uri, nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}" nonce="${nonce}" />
  <title>Variables</title>
</head>
<body>
  <div id="app" aria-label="Variables Manager">
    <div class="toolbar">
      <button id="add" aria-label="Add">Add</button>
    </div>
    <div id="list" role="table"></div>
    <div id="status" role="status"></div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
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
