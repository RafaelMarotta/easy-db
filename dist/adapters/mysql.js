"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MySqlClient = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
class MySqlClient {
    constructor() {
        this.pool = null;
    }
    async connect(cfg) {
        // password will be injected by extension before calling connect
        this.pool = promise_1.default.createPool({
            host: cfg.host,
            port: cfg.port,
            database: cfg.database,
            user: cfg.user,
            password: cfg.password,
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
    async disconnect() {
        if (this.pool) {
            await this.pool.end().catch(() => { });
            this.pool = null;
        }
    }
    ensure() {
        if (!this.pool)
            throw new Error("Not connected");
        return this.pool;
    }
    async listDatabases() {
        const p = this.ensure();
        const [rows] = await p.query("show databases");
        return rows.map(r => Object.values(r)[0]);
    }
    async listSchemas(db) {
        // MySQL doesn't have schemas separate from databases, return [db] or current
        const p = this.ensure();
        if (db)
            return [db];
        const [row] = await p.query("select database() as db");
        return [row[0]?.db ?? ""];
    }
    async listTables(schema) {
        const p = this.ensure();
        const [rows] = await p.query("select table_schema as schema_name, table_name as table_name from information_schema.tables where table_type='BASE TABLE' and table_schema = coalesce(?, database()) order by 1,2", [schema ?? null]);
        return rows.map(r => ({ schema: r.schema_name, name: r.table_name }));
    }
    async getTableInfo(ref) {
        const p = this.ensure();
        const [cols] = await p.query(`select COLUMN_NAME as name,
              DATA_TYPE as data_type,
              IS_NULLABLE as is_nullable,
              COLUMN_DEFAULT as column_default,
              COLUMN_KEY as column_key,
              EXTRA as extra
       from information_schema.columns
       where table_schema = ? and table_name = ?
       order by ordinal_position`, [ref.schema, ref.name]);
        const [fks] = await p.query(`select COLUMN_NAME as col
       from information_schema.KEY_COLUMN_USAGE
       where table_schema = ? and table_name = ? and referenced_table_name is not null`, [ref.schema, ref.name]);
        const [idx] = await p.query(`select INDEX_NAME as name,
              (NON_UNIQUE = 0) as is_unique,
              group_concat(COLUMN_NAME order by SEQ_IN_INDEX) as columns_str
       from information_schema.statistics
       where table_schema = ? and table_name = ?
       group by INDEX_NAME, NON_UNIQUE
       order by INDEX_NAME`, [ref.schema, ref.name]);
        const fkSet = new Set(fks.map(r => r.col));
        const columns = cols.map(r => ({
            name: r.name,
            dataType: r.data_type,
            nullable: String(r.is_nullable) === "YES",
            defaultValue: r.column_default ?? null,
            isPrimaryKey: String(r.column_key) === "PRI",
            isForeignKey: fkSet.has(r.name),
            isAutoIncrement: String(r.extra || "").toLowerCase().includes("auto_increment"),
        }));
        const indexes = idx.map(r => ({
            name: r.name,
            columns: String(r.columns_str || "").split(",").filter(Boolean),
            isUnique: !!r.is_unique,
        }));
        return { columns, indexes };
    }
    async *runQuery(sql, params = [], options) {
        const p = this.ensure();
        const pageSize = options?.pageSize ?? 200;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const conn = await p.getConnection();
        try {
            const baseSql = String(sql).trim().replace(/;\s*$/g, "");
            const [rows0, fields0] = await conn.query(`select * from (${baseSql}) t limit 0`, params);
            const columns = fields0?.map(f => f.name) ?? (rows0.length ? Object.keys(rows0[0]) : []);
            let offset = 0;
            while (true) {
                const [rows] = await conn.query(`select * from (${baseSql}) t limit ${pageSize} offset ${offset}`, params);
                if (!rows.length)
                    break;
                yield { id, columns, rows };
                offset += rows.length;
                if (rows.length < pageSize)
                    break;
            }
        }
        finally {
            conn.release();
        }
    }
    async insert(ref, row) {
        const p = this.ensure();
        const cols = Object.keys(row);
        const placeholders = cols.map(() => "?").join(",");
        const sql = `insert into ${this.qi(ref)} (${cols.map(n => this.q(n)).join(",")}) values (${placeholders})`;
        const [res] = await p.execute(sql, Object.values(row));
        return res.affectedRows ?? 0;
    }
    async update(ref, pk, patch) {
        const p = this.ensure();
        const setCols = Object.keys(patch);
        const whereCols = Object.keys(pk);
        const setSql = setCols.map(n => `${this.q(n)} = ?`).join(", ");
        const whereSql = whereCols.map(n => `${this.q(n)} = ?`).join(" and ");
        const sql = `update ${this.qi(ref)} set ${setSql} where ${whereSql}`;
        const [res] = await p.execute(sql, [...Object.values(patch), ...Object.values(pk)]);
        return res.affectedRows ?? 0;
    }
    async delete(ref, pk) {
        const p = this.ensure();
        const whereCols = Object.keys(pk);
        const whereSql = whereCols.map(n => `${this.q(n)} = ?`).join(" and ");
        const sql = `delete from ${this.qi(ref)} where ${whereSql}`;
        const [res] = await p.execute(sql, Object.values(pk));
        return res.affectedRows ?? 0;
    }
    async explain(sql) {
        const p = this.ensure();
        const [rows] = await p.query(`explain ${sql}`);
        if (!rows || rows.length === 0)
            return "";
        const cols = Object.keys(rows[0]);
        const header = cols.join("\t");
        const data = rows.map(r => cols.map(c => String(r[c] ?? "")).join("\t")).join("\n");
        return `${header}\n${data}`;
    }
    qi(ref) {
        const schema = ref.schema;
        return schema ? `${this.q(schema)}.${this.q(ref.name)}` : this.q(ref.name);
    }
    q(name) {
        return "`" + name.replace(/`/g, "``") + "`";
    }
}
exports.MySqlClient = MySqlClient;
//# sourceMappingURL=mysql.js.map