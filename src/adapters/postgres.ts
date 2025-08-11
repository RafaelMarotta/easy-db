import { Client, ClientConfig } from "pg";
import QueryStream from "pg-query-stream";
import { Readable } from "stream";
import {
  ColumnInfo,
  ConnectionConfig,
  DbClient,
  IndexInfo,
  QueryChunk,
  QueryOptions,
  TableRef
} from "./types";

export class PostgresClient implements DbClient {
  private client: Client | null = null;

  async connect(cfg: ConnectionConfig): Promise<void> {
    const pgCfg: ClientConfig = {
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: (cfg as any).password,
      // password is handled by extension, injected at runtime before connect
      ssl: cfg.ssl && cfg.ssl.mode !== "disable" ? { rejectUnauthorized: cfg.ssl.mode === "verify-full" } : undefined,
      connectionTimeoutMillis: cfg.timeouts?.connectMs,
    };
    this.client = new Client(pgCfg);
    const controller = new AbortController();
    const timeout = cfg.timeouts?.connectMs ?? 30000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      await this.client.connect();
    } finally {
      clearTimeout(timer);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end().catch(() => {});
      this.client = null;
    }
  }

  private ensure(): Client {
    if (!this.client) throw new Error("Not connected");
    return this.client;
  }

  async listDatabases(): Promise<string[]> {
    const c = this.ensure();
    const res = await c.query(`select datname from pg_database where datistemplate = false order by 1`);
    return res.rows.map((r: any) => r.datname as string);
  }

  async listSchemas(db?: string): Promise<string[]> {
    const c = this.ensure();
    // db switching is outside session; assume connected to desired db
    const res = await c.query(`select schema_name from information_schema.schemata order by 1`);
    return res.rows.map((r: any) => r.schema_name as string);
  }

  async listTables(schema?: string): Promise<TableRef[]> {
    const c = this.ensure();
    const params: any[] = [];
    let sql = `select table_schema as schema, table_name as name from information_schema.tables where table_type='BASE TABLE'`;
    if (schema) {
      sql += ` and table_schema = $1`;
      params.push(schema);
    }
    sql += ` order by 1,2`;
    const res = await c.query(sql, params);
    return res.rows.map((r: any) => ({ schema: r.schema as string, name: r.name as string } as TableRef));
  }

  async getTableInfo(ref: TableRef): Promise<{ columns: ColumnInfo[]; indexes: IndexInfo[] }> {
    const c = this.ensure();
    const colsRes = await c.query(
      `select column_name, is_nullable, data_type, column_default, is_identity
       from information_schema.columns
       where table_schema = $1 and table_name = $2
       order by ordinal_position`,
      [ref.schema ?? "public", ref.name]
    );

    const pkRes = await c.query(
      `select a.attname as col
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       join pg_class t on t.oid = i.indrelid
       join pg_namespace n on n.oid = t.relnamespace
       where i.indisprimary and n.nspname = $1 and t.relname = $2`,
      [ref.schema ?? "public", ref.name]
    );
    const pkCols = new Set<string>(pkRes.rows.map(r => r.col as string));

    const idxRes = await c.query(
      `select c2.relname as index_name,
              i.indisunique as is_unique,
              array_agg(a.attname order by arr.idx) as columns
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_index i on i.indrelid = c.oid
       join pg_class c2 on c2.oid = i.indexrelid
       join unnest(i.indkey) with ordinality as arr(attnum, idx) on true
       join pg_attribute a on a.attrelid = c.oid and a.attnum = arr.attnum
       where n.nspname = $1 and c.relname = $2
       group by c2.relname, i.indisunique
       order by 1`,
      [ref.schema ?? "public", ref.name]
    );

    const columns: ColumnInfo[] = colsRes.rows.map((r: any) => {
      const defaultValue: string | null = (r.column_default as any) ?? null;
      const isIdentity = String(r.is_identity ?? "NO") !== "NO";
      const isSerial = typeof defaultValue === "string" && /nextval\(/i.test(defaultValue);
      return {
        name: r.column_name as string,
        dataType: r.data_type as string,
        nullable: r.is_nullable === "YES",
        defaultValue,
        isPrimaryKey: pkCols.has(r.column_name as string),
        isAutoIncrement: isIdentity || isSerial,
      } as ColumnInfo;
    });
    const indexes: IndexInfo[] = idxRes.rows.map((r: any) => ({ name: r.index_name as string, columns: r.columns as string[], isUnique: !!r.is_unique }));

    return { columns, indexes };
  }

  async *runQuery(sql: string, params: any[] = [], options?: QueryOptions): AsyncIterable<QueryChunk> {
    const c = this.ensure();
    const pageSize = options?.pageSize ?? 200;
    const baseSql = String(sql).trim().replace(/;\s*$/g, "");
    const stream = new QueryStream(baseSql, params, { batchSize: pageSize });
    const query = (c as any).query(stream) as unknown as Readable & { fields?: { name: string }[] };
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const fieldsPromise: Promise<string[]> = new Promise((resolve) => {
      (query as any).once("fields", (fields: any[]) => resolve(fields.map(f => f.name)));
      setTimeout(async () => {
        if (!(query as any).fields) {
          const res = await c.query({ text: `select * from (${baseSql}) s limit 0`, values: params });
          resolve(res.fields.map(f => f.name));
        }
      }, 10);
    });

    const columns = await fieldsPromise;
    for await (const rows of query) {
      const chunk: QueryChunk = { id, columns, rows: Array.isArray(rows) ? rows : [rows] };
      yield chunk;
    }
  }

  async insert(ref: TableRef, row: Record<string, any>): Promise<number> {
    const c = this.ensure();
    const cols = Object.keys(row);
    const values = Object.values(row);
    const params = values.map((_, i) => `$${i + 1}`).join(",");
    const sql = `insert into ${this.qi(ref)} (${cols.map(n => this.q(n)).join(",")}) values (${params})`;
    const res = await c.query(sql, values);
    return res.rowCount ?? 0;
  }

  async update(ref: TableRef, pk: Record<string, any>, patch: Record<string, any>): Promise<number> {
    const c = this.ensure();
    const setCols = Object.keys(patch);
    const whereCols = Object.keys(pk);
    const values = [...Object.values(patch), ...Object.values(pk)];
    const setSql = setCols.map((n, i) => `${this.q(n)} = $${i + 1}`).join(", ");
    const whereSql = whereCols.map((n, i) => `${this.q(n)} = $${setCols.length + i + 1}`).join(" and ");
    const sql = `update ${this.qi(ref)} set ${setSql} where ${whereSql}`;
    const res = await c.query(sql, values);
    return res.rowCount ?? 0;
  }

  async delete(ref: TableRef, pk: Record<string, any>): Promise<number> {
    const c = this.ensure();
    const whereCols = Object.keys(pk);
    const values = Object.values(pk);
    const whereSql = whereCols.map((n, i) => `${this.q(n)} = $${i + 1}`).join(" and ");
    const sql = `delete from ${this.qi(ref)} where ${whereSql}`;
    const res = await c.query(sql, values);
    return res.rowCount ?? 0;
  }

  async explain(sql: string): Promise<string> {
    const c = this.ensure();
    const res = await c.query(`explain ${sql}`);
    return res.rows.map((r: any) => Object.values(r)[0]).join("\n");
  }

  private qi(ref: TableRef): string {
    const schema = ref.schema ?? "public";
    return `${this.q(schema)}.${this.q(ref.name)}`;
  }
  private q(name: string): string {
    return '"' + name.replace(/"/g, '""') + '"';
  }
}
