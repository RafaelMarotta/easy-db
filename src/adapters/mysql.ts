import mysql, { Pool, RowDataPacket, ResultSetHeader, PoolConnection, FieldPacket } from "mysql2/promise";
import {
  ColumnInfo,
  ConnectionConfig,
  DbClient,
  IndexInfo,
  QueryChunk,
  QueryOptions,
  TableRef
} from "./types";

export class MySqlClient implements DbClient {
  private pool: Pool | null = null;

  async connect(cfg: ConnectionConfig): Promise<void> {
    // password will be injected by extension before calling connect
    this.pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: (cfg as any).password,
      connectionLimit: cfg.pool?.max ?? 5,
      waitForConnections: true,
      enableKeepAlive: true,
      ssl: cfg.ssl && cfg.ssl.mode !== "disable" ? { rejectUnauthorized: cfg.ssl.mode === "verify-full" } : undefined,
      connectTimeout: cfg.timeouts?.connectMs,
    });
    // test a connection
    const conn = await this.pool.getConnection();
    await conn.ping();
    conn.release();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }

  private ensure(): Pool {
    if (!this.pool) throw new Error("Not connected");
    return this.pool;
  }

  async listDatabases(): Promise<string[]> {
    const p = this.ensure();
    const [rows] = await p.query<RowDataPacket[]>("show databases");
    return rows.map(r => Object.values(r)[0] as string);
  }

  async listSchemas(db?: string): Promise<string[]> {
    // MySQL doesn't have schemas separate from databases, return [db] or current
    const p = this.ensure();
    if (db) return [db];
    const [row] = await p.query<RowDataPacket[]>("select database() as db");
    return [row[0]?.db ?? ""];
  }

  async listTables(schema?: string): Promise<TableRef[]> {
    const p = this.ensure();
    const [rows] = await p.query<RowDataPacket[]>(
      "select table_schema as schema_name, table_name as table_name from information_schema.tables where table_type='BASE TABLE' and table_schema = coalesce(?, database()) order by 1,2",
      [schema ?? null]
    );
    return rows.map(r => ({ schema: (r as any).schema_name as string, name: (r as any).table_name as string }));
  }

  async getTableInfo(ref: TableRef): Promise<{ columns: ColumnInfo[]; indexes: IndexInfo[] }> {
    const p = this.ensure();
    const [cols] = await p.query<RowDataPacket[]>(
      `select COLUMN_NAME as name,
              DATA_TYPE as data_type,
              IS_NULLABLE as is_nullable,
              COLUMN_DEFAULT as column_default,
              COLUMN_KEY as column_key,
              EXTRA as extra
       from information_schema.columns
       where table_schema = ? and table_name = ?
       order by ordinal_position`,
      [ref.schema, ref.name]
    );
    const [fks] = await p.query<RowDataPacket[]>(
      `select COLUMN_NAME as col
       from information_schema.KEY_COLUMN_USAGE
       where table_schema = ? and table_name = ? and referenced_table_name is not null`,
      [ref.schema, ref.name]
    );
    const [idx] = await p.query<RowDataPacket[]>(
      `select INDEX_NAME as name,
              (NON_UNIQUE = 0) as is_unique,
              group_concat(COLUMN_NAME order by SEQ_IN_INDEX) as columns_str
       from information_schema.statistics
       where table_schema = ? and table_name = ?
       group by INDEX_NAME, NON_UNIQUE
       order by INDEX_NAME`,
      [ref.schema, ref.name]
    );
    const fkSet = new Set<string>(fks.map(r => (r as any).col as string));
    const columns: ColumnInfo[] = cols.map(r => ({
      name: (r as any).name as string,
      dataType: (r as any).data_type as string,
      nullable: String((r as any).is_nullable) === "YES",
      defaultValue: ((r as any).column_default as any) ?? null,
      isPrimaryKey: String((r as any).column_key) === "PRI",
      isForeignKey: fkSet.has((r as any).name as string),
      isAutoIncrement: String((r as any).extra || "").toLowerCase().includes("auto_increment"),
    }));
    const indexes: IndexInfo[] = idx.map(r => ({
      name: (r as any).name as string,
      columns: String((r as any).columns_str || "").split(",").filter(Boolean),
      isUnique: !!(r as any).is_unique,
    }));
    return { columns, indexes };
  }

  async *runQuery(sql: string, params: any[] = [], options?: QueryOptions): AsyncIterable<QueryChunk> {
    const p = this.ensure();
    const pageSize = options?.pageSize ?? 200;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conn = await p.getConnection();
    try {
      const baseSql = String(sql).trim().replace(/;\s*$/g, "");
      const [rows0, fields0] = await conn.query<RowDataPacket[]>(`select * from (${baseSql}) t limit 0`, params);
      const columns = (fields0 as FieldPacket[] | undefined)?.map(f => f.name) ?? (rows0.length ? Object.keys(rows0[0]) : []);
      let offset = 0;
      while (true) {
        const [rows] = await conn.query<RowDataPacket[]>(`select * from (${baseSql}) t limit ${pageSize} offset ${offset}`, params);
        if (!rows.length) break;
        yield { id, columns, rows };
        offset += rows.length;
        if (rows.length < pageSize) break;
      }
    } finally {
      conn.release();
    }
  }

  async insert(ref: TableRef, row: Record<string, any>): Promise<number> {
    const p = this.ensure();
    const cols = Object.keys(row);
    const placeholders = cols.map(() => "?").join(",");
    const sql = `insert into ${this.qi(ref)} (${cols.map(n => this.q(n)).join(",")}) values (${placeholders})`;
    const [res] = await p.execute<ResultSetHeader>(sql, Object.values(row));
    return res.affectedRows ?? 0;
  }

  async update(ref: TableRef, pk: Record<string, any>, patch: Record<string, any>): Promise<number> {
    const p = this.ensure();
    const setCols = Object.keys(patch);
    const whereCols = Object.keys(pk);
    const setSql = setCols.map(n => `${this.q(n)} = ?`).join(", ");
    const whereSql = whereCols.map(n => `${this.q(n)} = ?`).join(" and ");
    const sql = `update ${this.qi(ref)} set ${setSql} where ${whereSql}`;
    const [res] = await p.execute<ResultSetHeader>(sql, [...Object.values(patch), ...Object.values(pk)]);
    return res.affectedRows ?? 0;
  }

  async delete(ref: TableRef, pk: Record<string, any>): Promise<number> {
    const p = this.ensure();
    const whereCols = Object.keys(pk);
    const whereSql = whereCols.map(n => `${this.q(n)} = ?`).join(" and ");
    const sql = `delete from ${this.qi(ref)} where ${whereSql}`;
    const [res] = await p.execute<ResultSetHeader>(sql, Object.values(pk));
    return res.affectedRows ?? 0;
  }

  async explain(sql: string): Promise<string> {
    const p = this.ensure();
    const [rows] = await p.query<RowDataPacket[]>(`explain ${sql}`);
    if (!rows || rows.length === 0) return "";
    const cols = Object.keys(rows[0] as any);
    const header = cols.join("\t");
    const data = rows.map(r => cols.map(c => String((r as any)[c] ?? "")).join("\t")).join("\n");
    return `${header}\n${data}`;
  }

  private qi(ref: TableRef): string {
    const schema = ref.schema;
    return schema ? `${this.q(schema)}.${this.q(ref.name)}` : this.q(ref.name);
  }
  private q(name: string): string {
    return "`" + name.replace(/`/g, "``") + "`";
  }
}
