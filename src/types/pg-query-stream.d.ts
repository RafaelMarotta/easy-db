declare module "pg-query-stream" {
  import { QueryConfig } from "pg";
  import { Readable } from "stream";
  class QueryStream extends Readable {
    constructor(text: string, values?: any[], options?: { batchSize?: number });
  }
  export default QueryStream;
}
