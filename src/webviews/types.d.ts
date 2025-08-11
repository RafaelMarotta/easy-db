// Lightweight ambient declarations to quiet editor diagnostics for the webview bundle.
// The webview is built with esbuild and does not rely on the extension tsconfig.

declare module "react";
declare module "react-dom";
declare module "@glideapps/glide-data-grid";

declare function acquireVsCodeApi(): any;

declare var window: any;
declare var document: any;


