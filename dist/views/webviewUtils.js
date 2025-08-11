"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNonce = getNonce;
exports.sanitizeHtml = sanitizeHtml;
exports.resolveWebAssetUris = resolveWebAssetUris;
function getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
function sanitizeHtml(input) {
    return String(input ?? "").replace(/[&<>"]+/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
    }[ch]));
}
function resolveWebAssetUris(opts) {
    const vscode = require('vscode');
    const manifestPath = vscode.Uri.joinPath(opts.extensionUri, 'media', 'dist', '.vite', 'manifest.json');
    try {
        const data = require(manifestPath.fsPath);
        const entry = data['index.html'];
        const jsFiles = [];
        const cssFiles = [];
        const pushAsset = (p) => {
            const assetUri = opts.webview.asWebviewUri(vscode.Uri.joinPath(opts.extensionUri, 'media', 'dist', p));
            const s = assetUri.toString();
            if (p.endsWith('.js'))
                jsFiles.push(s);
            else if (p.endsWith('.css'))
                cssFiles.push(s);
        };
        if (entry?.file)
            pushAsset(entry.file);
        if (Array.isArray(entry?.css))
            entry.css.forEach((p) => pushAsset(p));
        if (Array.isArray(entry?.dynamicImports)) {
            entry.dynamicImports.forEach((p) => {
                const dynamicEntry = data[p];
                if (dynamicEntry?.file)
                    pushAsset(dynamicEntry.file);
            });
        }
        return { css: cssFiles, js: jsFiles };
    }
    catch {
        return { css: [], js: [] };
    }
}
//# sourceMappingURL=webviewUtils.js.map