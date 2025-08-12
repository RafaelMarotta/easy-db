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
const variables_1 = require("../utils/variables");
class VariablesViewPanel {
    constructor(ctx) {
        this.ctx = ctx;
    }
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
        const nonce = (0, webviewUtils_1.getNonce)();
        // Find variables.html entry from manifest (fallback handled below)
        const manifest = require(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", ".vite", "manifest.json").fsPath);
        const variablesEntry = manifest["variables.html"];
        const js = [];
        const css = [];
        const push = (p) => {
            const u = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", p)).toString();
            if (p.endsWith(".js"))
                js.push(u);
            else if (p.endsWith(".css"))
                css.push(u);
        };
        if (variablesEntry?.file)
            push(variablesEntry.file);
        if (Array.isArray(variablesEntry?.css))
            variablesEntry.css.forEach(push);
        const codiconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css"));
        if (js.length === 0) {
            // Fallback to hardcoded assets if manifest lookup fails
            const jsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "variables-DcU114Qf.js")).toString();
            const cssUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", "dist", "assets", "codicon-CUefaaAx.css")).toString();
            panel.webview.html = this.getHtml([jsUri], [codiconUri.toString(), cssUri], nonce, panel.webview.cspSource);
        }
        else {
            panel.webview.html = this.getHtml(js, [codiconUri.toString(), ...css], nonce, panel.webview.cspSource);
        }
        panel.webview.onDidReceiveMessage(async (msg) => {
            try {
                if (msg.type === "variablesList") {
                    const vars = await (0, variables_1.gatherVariables)(this.ctx);
                    const items = vars.map(v => ({ id: v.id, value: v.value ?? "" }));
                    this.post({ type: "variablesList", items });
                }
                else if (msg.type === "variablesBulkSave") {
                    await (0, variables_1.saveVariablesBulk)(this.ctx, msg.items || []);
                    this.post({ type: "variablesSaved" });
                }
                else if (msg.type === "variableDelete") {
                    await (0, variables_1.deleteVariable)(this.ctx, String(msg.id));
                    this.post({ type: "variableDeleted" });
                }
            }
            catch (err) {
                this.post({ type: "error", message: String(err?.message ?? err) });
            }
        });
    }
    getHtml(jsUris, cssUris, nonce, cspSource) {
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