import React from "react";
import { CellEditorProps } from "./types";

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function isIso8601WithTz(v: string): boolean {
  return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(Z|[+\-]\d{2}:?\d{2})$/i.test(v);
}
function parseIsoOffsetMinutes(v: string): number | null {
  const m = v.match(/(Z|z|([+\-])(\d{2}):?(\d{2}))$/);
  if (!m) return null;
  if ((m[1] || '').toString().toUpperCase() === 'Z') return 0;
  const sign = m[2] === '+' ? 1 : -1;
  const hh = Number(m[3] || '0');
  const mm = Number(m[4] || '0');
  return sign * (hh * 60 + mm);
}
function toInputDateTimeLocal(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function parseDateTimeLocalWithOffset(v: string, offsetMin: number): Date | null {
  const m = v.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/);
  if (!m) return null;
  const [_, ys, ms, ds, hs, mins, ss] = m;
  const y = Number(ys), mo = Number(ms) - 1, d = Number(ds), h = Number(hs), mi = Number(mins), s = Number(ss ?? "0");
  const utcMs = Date.UTC(y, mo, d, h, mi, s) - offsetMin * 60000;
  return new Date(utcMs);
}
function formatIsoWithOffsetMinutes(dateUtc: Date, offsetMin: number): string {
  const ms = dateUtc.getTime() + offsetMin * 60000;
  const d = new Date(ms);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = pad2(Math.floor(abs / 60));
  const om = pad2(abs % 60);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
         `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}${sign}${oh}:${om}`;
}

export function DateTimeEditor({ value, rowIndex, columnId, readOnly, onEdit }: CellEditorProps) {
  const [localValue, setLocalValue] = React.useState(value == null ? "" : String(value));
  const [errorText, setErrorText] = React.useState<string>("");
  const [tzOffsetMin, setTzOffsetMin] = React.useState<number>(() => 0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const v = value == null ? "" : String(value);
    setLocalValue(v);
    setErrorText("");
    const off = parseIsoOffsetMinutes(v);
    if (off !== null) setTzOffsetMin(off);
  }, [value]);

  if (readOnly) {
    return <div style={{ padding: "4px 8px", color: "var(--vscode-descriptionForeground)" }}>{value == null ? "" : String(value)}</div>;
  }

  const commonStyle: React.CSSProperties = {
    width: "100%",
    background: "transparent",
    border: `1px solid ${errorText ? 'var(--vscode-inputValidation-errorBorder)' : 'transparent'}`,
    color: "var(--vscode-foreground)",
    padding: "4px 8px",
    outline: "none",
    borderRadius: 3,
  };

  const iconButtonStyle: React.CSSProperties = {
    position: 'relative',
    background: "var(--vscode-button-background)",
    color: "var(--vscode-button-foreground)",
    border: "1px solid var(--vscode-button-border)",
    padding: "4px 8px",
    borderRadius: 3,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginLeft: 6,
    height: 26,
  };

  const tzOptions = React.useMemo(() => {
    const opts: Array<{ label: string; value: number }> = [];
    for (let m = -12 * 60; m <= 14 * 60; m += 15) {
      const sign = m >= 0 ? '+' : '-';
      const abs = Math.abs(m);
      const hh = pad2(Math.floor(abs / 60));
      const mm = pad2(abs % 60);
      opts.push({ label: `UTC${sign}${hh}:${mm}`, value: m });
    }
    return opts;
  }, []);

  const inputLocal = localValue && isIso8601WithTz(localValue) ? toInputDateTimeLocal(localValue) : "";

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        ref={inputRef}
        type="text"
        placeholder="YYYY-MM-DDTHH:mm:ssZ or ±HH:MM"
        value={localValue}
        onChange={(e) => {
          const v = e.target.value;
          setLocalValue(v);
          setErrorText(v === "" || isIso8601WithTz(v) ? "" : "Invalid ISO 8601 (needs timezone)");
          onEdit(rowIndex, columnId, v);
        }}
        onBlur={() => {
          if (isIso8601WithTz(localValue)) {
            const off = parseIsoOffsetMinutes(localValue);
            if (off !== null) setTzOffsetMin(off);
          }
          onEdit(rowIndex, columnId, localValue);
        }}
        style={{ ...commonStyle, flex: 1 }}
      />
      <button type="button" title="Pick date & time" style={iconButtonStyle}>
        <i className="codicon codicon-calendar" />
        <input
          type="datetime-local"
          step={1}
          value={inputLocal}
          onChange={(e) => {
            const raw = e.target.value || ""; // yyyy-MM-ddTHH:mm[:ss]
            if (raw) {
              const dtUtc = parseDateTimeLocalWithOffset(raw, tzOptions.find(o => o.value === tzOffsetMin)?.value ?? 0);
              if (dtUtc) {
                const iso = formatIsoWithOffsetMinutes(dtUtc, tzOffsetMin);
                setLocalValue(iso);
                setErrorText("");
                onEdit(rowIndex, columnId, iso);
                inputRef.current?.focus();
              }
            }
          }}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
        />
      </button>
      <select
        value={tzOffsetMin}
        onChange={(e) => {
          const next = Number(e.target.value);
          setTzOffsetMin(next);
          if (localValue && isIso8601WithTz(localValue)) {
            const baseUtc = new Date(localValue);
            if (!Number.isNaN(baseUtc.getTime())) {
              const iso = formatIsoWithOffsetMinutes(baseUtc, next);
              setLocalValue(iso);
              onEdit(rowIndex, columnId, iso);
            }
          }
        }}
        title="Timezone"
        style={{
          background: "var(--vscode-button-secondaryBackground)",
          color: "var(--vscode-button-secondaryForeground)",
          border: "1px solid var(--vscode-button-secondaryBorder, transparent)",
          padding: '3px 6px',
          borderRadius: 3,
          cursor: 'pointer',
        }}
      >
        {tzOptions.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}


