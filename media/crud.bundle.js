"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/webviews/crudApp.tsx
  var import_react = __toESM(__require("react"));
  var import_react_dom = __toESM(__require("react-dom"));
  var import_glide_data_grid = __toESM(__require("@glideapps/glide-data-grid"));
  var import_jsx_runtime = __require("react/jsx-runtime");
  var vscode = window.acquireVsCodeApi?.() || { postMessage: (_) => {
  } };
  function App() {
    const [columns, setColumns] = (0, import_react.useState)([]);
    const [rows, setRows] = (0, import_react.useState)([]);
    const [pk, setPk] = (0, import_react.useState)(/* @__PURE__ */ new Set());
    const editsRef = (0, import_react.useRef)(/* @__PURE__ */ new Map());
    const gridColumns = (0, import_react.useMemo)(() => columns.map((c) => ({ title: c })), [columns]);
    const getCellContent = (0, import_react.useCallback)((item) => {
      const [col, row] = item;
      const key = columns[col];
      const r = rows[row];
      const value = r ? r[key] : void 0;
      return {
        kind: import_glide_data_grid.GridCellKind.Text,
        displayData: value == null ? "" : String(value),
        data: value == null ? "" : String(value),
        allowOverlay: true,
        readonly: pk.has(key)
      };
    }, [columns, rows, pk]);
    const onCellEdited = (0, import_react.useCallback)((cell, newValue) => {
      const [col, row] = cell;
      const key = columns[col];
      if (pk.has(key)) return;
      const newText = newValue.data;
      const patch = editsRef.current.get(row) ?? {};
      patch[key] = newText;
      editsRef.current.set(row, patch);
    }, [columns, pk]);
    const commit = (0, import_react.useCallback)(async () => {
      for (const [rowIdx, patch] of editsRef.current.entries()) {
        const row = rows[rowIdx];
        const pkObj = {};
        const pkCols = Array.from(pk);
        if (pkCols.length) {
          for (const k of pkCols) pkObj[k] = row[k];
        } else if (columns.length) {
          pkObj[columns[0]] = row[columns[0]];
        }
        vscode.postMessage({ type: "editRow", pk: pkObj, patch });
      }
      editsRef.current.clear();
    }, [rows, pk, columns]);
    const refresh = (0, import_react.useCallback)(() => {
      setColumns([]);
      setRows([]);
      editsRef.current.clear();
      vscode.postMessage({ type: "fetchPage", pageSize: 100, offset: 0 });
    }, []);
    import_react.default.useEffect(() => {
      const onMessage = (e) => {
        const msg = e.data;
        if (msg.type === "schema") setPk(new Set(msg.pkColumns || []));
        if (msg.type === "queryChunk") {
          if (columns.length === 0) setColumns(msg.columns);
          setRows((prev) => prev.concat(msg.rows));
        }
        if (msg.type === "queryDone") {
        }
      };
      window.addEventListener("message", onMessage);
      vscode.postMessage({ type: "fetchPage", pageSize: 100, offset: 0 });
      return () => window.removeEventListener("message", onMessage);
    }, []);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { height: "100vh", display: "flex", flexDirection: "column" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: 6, display: "flex", gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: refresh, title: "Refresh", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "codicon codicon-refresh" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { onClick: commit, title: "Commit", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "codicon codicon-check" }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { flex: 1 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_glide_data_grid.default,
        {
          columns: gridColumns,
          getCellContent,
          rows: rows.length,
          onCellEdited,
          smoothScrollX: true,
          smoothScrollY: true
        }
      ) })
    ] });
  }
  import_react_dom.default.render(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(App, {}), document.getElementById("root"));
})();
