export function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function sanitizeHtml(input: string): string {
  return String(input ?? "").replace(/[&<>"]+/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[ch as '&' | '<' | '>' | '"']!));
}

export function resolveWebAssetUris(opts: {
  webview: import('vscode').Webview;
  extensionUri: import('vscode').Uri;
  manifestFile?: string; // defaults to media/dist/.vite/manifest.json
}): { css: string[]; js: string[] } {
  const vscode = require('vscode') as typeof import('vscode');
  const manifestPath = vscode.Uri.joinPath(opts.extensionUri, 'media', 'dist', '.vite', 'manifest.json');
  try {
    const data = require(manifestPath.fsPath);
    const entry = data['index.html'];
    const jsFiles: string[] = [];
    const cssFiles: string[] = [];
    const pushAsset = (p: string) => {
      const assetUri = opts.webview.asWebviewUri(vscode.Uri.joinPath(opts.extensionUri, 'media', 'dist', p));
      const s = assetUri.toString();
      if (p.endsWith('.js')) jsFiles.push(s); else if (p.endsWith('.css')) cssFiles.push(s);
    };
    if (entry?.file) pushAsset(entry.file);
    if (Array.isArray(entry?.css)) entry.css.forEach((p: string) => pushAsset(p));
    if (Array.isArray(entry?.dynamicImports)) {
      entry.dynamicImports.forEach((p: string) => {
        const dynamicEntry = data[p];
        if (dynamicEntry?.file) pushAsset(dynamicEntry.file);
      });
    }
    return { css: cssFiles, js: jsFiles };
  } catch {
    return { css: [], js: [] };
  }
}
