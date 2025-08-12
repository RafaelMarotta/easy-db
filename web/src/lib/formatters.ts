export interface DateTimeFormatter {
  toSqlDateTime(value: string): string;
  toSqlDate(value: string): string;
}

export class MySqlDateTimeFormatter implements DateTimeFormatter {
  private pad2(n: number): string { return String(n).padStart(2, "0"); }
  toSqlDateTime(isoLike: string): string {
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return isoLike;
    const yyyy = d.getFullYear();
    const mm = this.pad2(d.getMonth() + 1);
    const dd = this.pad2(d.getDate());
    const hh = this.pad2(d.getHours());
    const mi = this.pad2(d.getMinutes());
    const ss = this.pad2(d.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
  toSqlDate(isoLike: string): string {
    const d = new Date(isoLike);
    if (Number.isNaN(d.getTime())) return isoLike;
    const yyyy = d.getFullYear();
    const mm = this.pad2(d.getMonth() + 1);
    const dd = this.pad2(d.getDate());
    return `${yyyy}-${mm}-${dd}`;
  }
}

export const defaultFormatter = new MySqlDateTimeFormatter();


