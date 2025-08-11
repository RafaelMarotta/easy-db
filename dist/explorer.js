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
exports.TableNode = exports.ExplorerNode = exports.DbExplorerProvider = void 0;
const vscode = __importStar(require("vscode"));
class DbExplorerProvider {
    constructor(connections, getClient) {
        this.connections = connections;
        this.getClient = getClient;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            const conns = await this.connections();
            return conns.map(c => {
                const n = new ExplorerNode("connection", c.name, vscode.TreeItemCollapsibleState.Collapsed, { connectionId: c.id });
                n.contextValue = "connection";
                return n;
            });
        }
        const ctx = element.contextData ?? {};
        if (element.nodeType === "connection") {
            const client = await this.getClient(ctx.connectionId);
            if (!client) {
                const n = new ExplorerNode("info", "Connect (not connected)", vscode.TreeItemCollapsibleState.None, { connectionId: ctx.connectionId });
                n.iconPath = new vscode.ThemeIcon("plug");
                n.command = { command: "easyDb.connect", title: "Connect", arguments: [ctx.connectionId] };
                return [n];
            }
            const dbs = await client.listDatabases();
            return dbs.map((db) => {
                const n = new ExplorerNode("database", db, vscode.TreeItemCollapsibleState.Collapsed, { connectionId: ctx.connectionId, database: db });
                n.contextValue = "database";
                n.iconPath = new vscode.ThemeIcon("database");
                return n;
            });
        }
        if (element.nodeType === "database") {
            const client = await this.getClient(ctx.connectionId);
            if (!client)
                return [];
            try {
                const schemas = await client.listSchemas(ctx.database);
                const nodes = [];
                for (const s of schemas) {
                    const tables = await client.listTables(s);
                    for (const t of tables) {
                        nodes.push(new TableNode({ database: ctx.database, schema: t.schema ?? s, name: t.name }, ctx.connectionId));
                    }
                }
                if (nodes.length === 0) {
                    const info = new ExplorerNode("info", "No tables found", vscode.TreeItemCollapsibleState.None);
                    return [info];
                }
                return nodes;
            }
            catch (e) {
                const msg = String(e?.message ?? e).replace(/\n/g, ' ');
                const err = new ExplorerNode("info", `Error: ${msg}`, vscode.TreeItemCollapsibleState.None);
                return [err];
            }
        }
        if (element.nodeType === "schema") {
            const client = await this.getClient(ctx.connectionId);
            if (!client)
                return [];
            const tables = await client.listTables(ctx.schema);
            return tables.map(t => new TableNode({ database: ctx.database, schema: t.schema ?? ctx.schema, name: t.name }, ctx.connectionId));
        }
        if (element.nodeType === "table") {
            const client = await this.getClient(ctx.connectionId);
            if (!client)
                return [];
            const info = await client.getTableInfo(ctx.ref);
            const columnGroup = new ExplorerNode("info", "Columns", vscode.TreeItemCollapsibleState.Collapsed, { connectionId: ctx.connectionId, ref: ctx.ref, _columns: info.columns });
            columnGroup.iconPath = new vscode.ThemeIcon("list-tree");
            const indexesGroup = new ExplorerNode("info", "Indexes", vscode.TreeItemCollapsibleState.Collapsed, { connectionId: ctx.connectionId, ref: ctx.ref, _indexes: info.indexes });
            indexesGroup.iconPath = new vscode.ThemeIcon("symbol-number");
            return [columnGroup, indexesGroup];
        }
        if (element.nodeType === "info" && element.label === "Columns") {
            const cols = element.contextData?._columns || [];
            return cols.map((c) => {
                const node = new ExplorerNode("column", `${c.name} : ${c.dataType}`, vscode.TreeItemCollapsibleState.None);
                if (c.isPrimaryKey)
                    node.iconPath = new vscode.ThemeIcon("key");
                else if (c.isForeignKey)
                    node.iconPath = new vscode.ThemeIcon("link");
                else
                    node.iconPath = new vscode.ThemeIcon("symbol-field");
                return node;
            });
        }
        if (element.nodeType === "info" && element.label === "Indexes") {
            const idx = element.contextData?._indexes || [];
            return idx.map((i) => {
                const node = new ExplorerNode("index", `${i.name}${i.isUnique ? " (unique)" : ""} [${i.columns.join(", ")}]`, vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon("hash");
                return node;
            });
        }
        return [];
    }
}
exports.DbExplorerProvider = DbExplorerProvider;
class ExplorerNode extends vscode.TreeItem {
    constructor(nodeType, labelText, collapsibleState, contextData) {
        super(labelText, collapsibleState);
        this.nodeType = nodeType;
        this.labelText = labelText;
        this.collapsibleState = collapsibleState;
        this.contextData = contextData;
        this.contextValue = nodeType;
        if (nodeType === "connection")
            this.iconPath = new vscode.ThemeIcon("plug");
    }
}
exports.ExplorerNode = ExplorerNode;
class TableNode extends ExplorerNode {
    constructor(ref, connectionId) {
        super("table", ref.name, vscode.TreeItemCollapsibleState.Collapsed, { connectionId, ref });
        this.ref = ref;
        this.connectionId = connectionId;
        this.command = {
            command: "easyDb.openCrud",
            title: "Open CRUD",
            arguments: [connectionId, ref]
        };
        this.contextValue = "table";
        this.tooltip = `${ref.schema ?? ""}.${ref.name}`;
        this.iconPath = new vscode.ThemeIcon("table");
    }
}
exports.TableNode = TableNode;
//# sourceMappingURL=explorer.js.map