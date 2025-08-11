import * as vscode from "vscode";
import { DbClient, TableRef } from "./adapters/types";

export type ExplorerNodeType = "root" | "connection" | "database" | "schema" | "table" | "column" | "index" | "info";

export interface ConnectionItem {
  id: string;
  name: string;
  client: DbClient | null;
}

export class DbExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ExplorerNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly connections: () => Promise<ConnectionItem[]>,
    private readonly getClient: (connectionId: string) => Promise<DbClient | null> | DbClient | null
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ExplorerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!element) {
      const conns = await this.connections();
      return conns.map(c => {
        const n = new ExplorerNode("connection", c.name, vscode.TreeItemCollapsibleState.Collapsed, { connectionId: c.id });
        n.contextValue = "connection";
        return n;
      });
    }
    const ctx = element.contextData ?? {} as any;
    if (element.nodeType === "connection") {
      const client = await this.getClient(ctx.connectionId);
      if (!client) {
        const n = new ExplorerNode("info", "Connect (not connected)", vscode.TreeItemCollapsibleState.None, { connectionId: ctx.connectionId });
        n.iconPath = new vscode.ThemeIcon("plug");
        n.command = { command: "easyDb.connect", title: "Connect", arguments: [ctx.connectionId] };
        return [n];
      }
      const dbs = await client.listDatabases();
      return dbs.map((db: string) => {
        const n = new ExplorerNode("database", db, vscode.TreeItemCollapsibleState.Collapsed, { connectionId: ctx.connectionId, database: db });
        n.contextValue = "database";
        n.iconPath = new vscode.ThemeIcon("database");
        return n;
      });
    }
    if (element.nodeType === "database") {
      const client = await this.getClient(ctx.connectionId);
      if (!client) return [];
      try {
        const schemas = await client.listSchemas(ctx.database);
        const nodes: ExplorerNode[] = [];
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
      } catch (e: any) {
        const msg = String(e?.message ?? e).replace(/\n/g, ' ');
        const err = new ExplorerNode("info", `Error: ${msg}`, vscode.TreeItemCollapsibleState.None);
        return [err];
      }
    }
    if (element.nodeType === "schema") {
      const client = await this.getClient(ctx.connectionId);
      if (!client) return [];
      const tables = await client.listTables(ctx.schema);
      return tables.map(t => new TableNode({ database: ctx.database, schema: t.schema ?? ctx.schema, name: t.name }, ctx.connectionId));
    }
    if (element.nodeType === "table") {
      const client = await this.getClient(ctx.connectionId);
      if (!client) return [];
      const info = await client.getTableInfo(ctx.ref as TableRef);
      const columnGroup = new ExplorerNode("info", "Columns", vscode.TreeItemCollapsibleState.Collapsed, { connectionId: ctx.connectionId, ref: ctx.ref, _columns: info.columns });
      columnGroup.iconPath = new vscode.ThemeIcon("list-tree");
      const indexesGroup = new ExplorerNode("info", "Indexes", vscode.TreeItemCollapsibleState.Collapsed, { connectionId: ctx.connectionId, ref: ctx.ref, _indexes: info.indexes });
      indexesGroup.iconPath = new vscode.ThemeIcon("symbol-number");
      return [columnGroup, indexesGroup];
    }
    if (element.nodeType === "info" && element.label === "Columns") {
      const cols: any[] = (element.contextData?._columns as any[]) || [];
      return cols.map((c: any) => {
        const node = new ExplorerNode("column", `${c.name} : ${c.dataType}`, vscode.TreeItemCollapsibleState.None);
        if (c.isPrimaryKey) node.iconPath = new vscode.ThemeIcon("key");
        else if (c.isForeignKey) node.iconPath = new vscode.ThemeIcon("link");
        else node.iconPath = new vscode.ThemeIcon("symbol-field");
        return node;
      });
    }
    if (element.nodeType === "info" && element.label === "Indexes") {
      const idx: any[] = (element.contextData?._indexes as any[]) || [];
      return idx.map((i: any) => {
        const node = new ExplorerNode("index", `${i.name}${i.isUnique ? " (unique)" : ""} [${i.columns.join(", ")}]`, vscode.TreeItemCollapsibleState.None);
        node.iconPath = new vscode.ThemeIcon("hash");
        return node;
      });
    }
    return [];
  }
}

export class ExplorerNode extends vscode.TreeItem {
  constructor(
    public readonly nodeType: ExplorerNodeType,
    public readonly labelText: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextData?: Record<string, any>
  ) {
    super(labelText, collapsibleState);
    this.contextValue = nodeType;
    if (nodeType === "connection") this.iconPath = new vscode.ThemeIcon("plug");
  }
}

export class TableNode extends ExplorerNode {
  constructor(public readonly ref: TableRef, public readonly connectionId: string) {
    super("table", ref.name, vscode.TreeItemCollapsibleState.Collapsed, { connectionId, ref });
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
