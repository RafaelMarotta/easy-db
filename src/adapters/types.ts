export type VariableScope = "user" | "workspace" | "connection";

export interface Variable {
  id: string;
  scope: VariableScope;
  value?: string;
  isSecret?: boolean;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  driver: "postgres" | "mysql";
  host: string;
  port: number;
  database?: string;
  user?: string;
  passwordSecretKey?: string; // SecretStorage key
  ssl?: { mode: "disable" | "require" | "verify-ca" | "verify-full"; caPath?: string };
  ssh?: { host: string; user: string; keyPath?: string; passphraseSecretKey?: string; port?: number };
  pool?: { max?: number; idleMs?: number };
  timeouts?: { connectMs?: number; queryMs?: number };
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string | null;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  isAutoIncrement?: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique?: boolean;
}

export interface TableRef {
  database?: string;
  schema?: string;
  name: string;
}

export interface QueryOptions {
  pageSize?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface QueryChunk {
  id: string;
  columns: string[];
  rows: any[];
}

export interface DbClient {
  connect(cfg: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  listDatabases(): Promise<string[]>;
  listSchemas(db?: string): Promise<string[]>;
  listTables(schema?: string): Promise<TableRef[]>;
  getTableInfo(ref: TableRef): Promise<{ columns: ColumnInfo[]; indexes: IndexInfo[] }>;
  runQuery(sql: string, params?: any[], options?: QueryOptions): AsyncIterable<QueryChunk>;
  insert(ref: TableRef, row: Record<string, any>): Promise<number>;
  update(ref: TableRef, pk: Record<string, any>, patch: Record<string, any>): Promise<number>;
  delete(ref: TableRef, pk: Record<string, any>): Promise<number>;
  explain(sql: string): Promise<string>;
}
