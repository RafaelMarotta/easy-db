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
exports.VariablesViewPanel = void 0;
const vscode = __importStar(require("vscode"));
const webviewUtils_1 = require("./webviewUtils");
class VariablesViewPanel {
    constructor(ctx) {
        this.ctx = ctx;
    }
    open() {
        const panel = vscode.window.createWebviewPanel(VariablesViewPanel.viewType, `Variables`, vscode.ViewColumn.Active, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")]
        });
        this.panel = panel;
        const nonce = (0, webviewUtils_1.getNonce)();
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "variables.js"));
        const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "variables.css"));
        panel.webview.html = this.getHtml(scriptUri, styleUri, nonce);
        panel.webview.onDidReceiveMessage(async (msg) => {
            try {
                if (msg.type === "list") {
                    const all = await this.loadVariables();
                    this.post({ type: "variables", items: all.map(v => ({ ...v, value: v.isSecret ? undefined : v.value })) });
                }
                else if (msg.type === "save") {
                    await this.saveVariable(msg.variable);
                    this.post({ type: "saved" });
                }
                else if (msg.type === "delete") {
                    await this.deleteVariable(String(msg.id));
                    this.post({ type: "deleted" });
                }
            }
            catch (err) {
                this.post({ type: "error", message: String(err?.message ?? err) });
            }
        });
    }
    getHtml(scriptUri, styleUri, nonce) {
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
    async loadVariables() {
        const ws = this.ctx.workspaceState.get("variables", []);
        const gs = this.ctx.globalState.get("variables", []);
        return [...(ws ?? []), ...(gs ?? [])];
    }
    async saveVariable(v) {
        const target = v.scope === "workspace" ? this.ctx.workspaceState : this.ctx.globalState;
        const list = target.get("variables", []);
        const next = (list ?? []).filter(x => x.id !== v.id).concat([{ ...v, value: v.isSecret ? undefined : (v.value ?? "") }]);
        await target.update("variables", next);
        if (v.isSecret && v.value) {
            await this.ctx.secrets.store(`var:${v.id}`, v.value);
        }
    }
    async deleteVariable(id) {
        const ws = this.ctx.workspaceState.get("variables", []);
        const gs = this.ctx.globalState.get("variables", []);
        await this.ctx.workspaceState.update("variables", (ws ?? []).filter(v => v.id !== id));
        await this.ctx.globalState.update("variables", (gs ?? []).filter(v => v.id !== id));
        await this.ctx.secrets.delete(`var:${id}`);
    }
    post(message) {
        this.panel?.webview.postMessage(message);
    }
}
exports.VariablesViewPanel = VariablesViewPanel;
VariablesViewPanel.viewType = "easyDb.variables";
//# sourceMappingURL=variablesView.js.map