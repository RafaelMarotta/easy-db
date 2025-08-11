"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostgresClient = void 0;
const pg_1 = require("pg");
const pg_query_stream_1 = __importDefault(require("pg-query-stream"));
class PostgresClient {
    constructor() {
        this.client = null;
    }
    async connect(cfg) {
        const pgCfg = {
            host: cfg.host,
            port: cfg.port,
            database: cfg.database,
            user: cfg.user,
            password: cfg.password,
            // password is handled by extension, injected at runtime before connect
            ssl: cfg.ssl && cfg.ssl.mode !== "disable" ? { rejectUnauthorized: cfg.ssl.mode === "verify-full" } : undefined,
            connectionTimeoutMillis: cfg.timeouts?.connectMs,
        };
        this.client = new pg_1.Client(pgCfg);
        const controller = new AbortController();
        const timeout = cfg.timeouts?.connectMs ?? 30000;
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            await this.client.connect();
        }
        finally {
            clearTimeout(timer);
        }
    }
    async disconnect() {
        if (this.client) {
            await this.client.end().catch(() => { });
            this.client = null;
        }
    }
    ensure() {
        if (!this.client)
            throw new Error("Not connected");
        return this.client;
    }
    async listDatabases() {
        const c = this.ensure();
        const res = await c.query(`select datname from pg_database where datistemplate = false order by 1`);
        return res.rows.map((r) => r.datname);
    }
    async listSchemas(db) {
        const c = this.ensure();
        // db switching is outside session; assume connected to desired db
        const res = await c.query(`select schema_name from information_schema.schemata order by 1`);
        return res.rows.map((r) => r.schema_name);
    }
    async listTables(schema) {
        const c = this.ensure();
        const params = [];
        let sql = `select table_schema as schema, table_name as name from information_schema.tables where table_type='BASE TABLE'`;
        if (schema) {
            sql += ` and table_schema = $1`;
            params.push(schema);
        }
        sql += ` order by 1,2`;
        const res = await c.query(sql, params);
        return res.rows.map((r) => ({ schema: r.schema, name: r.name }));
    }
    async getTableInfo(ref) {
        const c = this.ensure();
        const colsRes = await c.query(`select column_name, is_nullable, data_type, column_default, is_identity
       from information_schema.columns
       where table_schema = $1 and table_name = $2
       order by ordinal_position`, [ref.schema ?? "public", ref.name]);
        const pkRes = await c.query(`select a.attname as col
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       join pg_class t on t.oid = i.indrelid
       join pg_namespace n on n.oid = t.relnamespace
       where i.indisprimary and n.nspname = $1 and t.relname = $2`, [ref.schema ?? "public", ref.name]);
        const pkCols = new Set(pkRes.rows.map(r => r.col));
        const idxRes = await c.query(`select c2.relname as index_name,
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
       order by 1`, [ref.schema ?? "public", ref.name]);
        const columns = colsRes.rows.map((r) => {
            const defaultValue = r.column_default ?? null;
            const isIdentity = String(r.is_identity ?? "NO") !== "NO";
            const isSerial = typeof defaultValue === "string" && /nextval\(/i.test(defaultValue);
            return {
                name: r.column_name,
                dataType: r.data_type,
                nullable: r.is_nullable === "YES",
                defaultValue,
                isPrimaryKey: pkCols.has(r.column_name),
                isAutoIncrement: isIdentity || isSerial,
            };
        });
        const indexes = idxRes.rows.map((r) => ({ name: r.index_name, columns: r.columns, isUnique: !!r.is_unique }));
        return { columns, indexes };
    }
    async *runQuery(sql, params = [], options) {
        const c = this.ensure();
        const pageSize = options?.pageSize ?? 200;
        const baseSql = String(sql).trim().replace(/;\s*$/g, "");
        const stream = new pg_query_stream_1.default(baseSql, params, { batchSize: pageSize });
        const query = c.query(stream);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const fieldsPromise = new Promise((resolve) => {
            query.once("fields", (fields) => resolve(fields.map(f => f.name)));
            setTimeout(async () => {
                if (!query.fields) {
                    const res = await c.query({ text: `select * from (${baseSql}) s limit 0`, values: params });
                    resolve(res.fields.map(f => f.name));
                }
            }, 10);
        });
        const columns = await fieldsPromise;
        for await (const rows of query) {
            const chunk = { id, columns, rows: Array.isArray(rows) ? rows : [rows] };
            yield chunk;
        }
    }
    async insert(ref, row) {
        const c = this.ensure();
        const cols = Object.keys(row);
        const values = Object.values(row);
        const params = values.map((_, i) => `$${i + 1}`).join(",");
        const sql = `insert into ${this.qi(ref)} (${cols.map(n => this.q(n)).join(",")}) values (${params})`;
        const res = await c.query(sql, values);
        return res.rowCount ?? 0;
    }
    async update(ref, pk, patch) {
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
    async delete(ref, pk) {
        const c = this.ensure();
        const whereCols = Object.keys(pk);
        const values = Object.values(pk);
        const whereSql = whereCols.map((n, i) => `${this.q(n)} = $${i + 1}`).join(" and ");
        const sql = `delete from ${this.qi(ref)} where ${whereSql}`;
        const res = await c.query(sql, values);
        return res.rowCount ?? 0;
    }
    async explain(sql) {
        const c = this.ensure();
        const res = await c.query(`explain ${sql}`);
        return res.rows.map((r) => Object.values(r)[0]).join("\n");
    }
    qi(ref) {
        const schema = ref.schema ?? "public";
        return `${this.q(schema)}.${this.q(ref.name)}`;
    }
    q(name) {
        return '"' + name.replace(/"/g, '""') + '"';
    }
}
exports.PostgresClient = PostgresClient;
//# sourceMappingURL=postgres.js.map