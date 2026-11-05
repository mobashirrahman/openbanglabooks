/**
 * CSV as RFC 4180 has it: commas, double-quoted fields, "" for a quote
 * inside one, and CRLF or LF between records. Enough for Goodreads exports
 * and for files spreadsheets write.
 */

/** Parses CSV text into rows of fields. A byte-order mark is ignored; blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r" || c === "\n") {
      endRow();
      i += c === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

// A cell a spreadsheet would run as a formula (OWASP "CSV injection").
const FORMULA = /^[=+\-@\t\r]/;

function cell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Writes rows as CSV with CRLF line ends, quoting only where needed. */
export function writeCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Undoes the formula guard writeCsv adds, for files that come back. */
export const unguard = (s: string) => (s.length > 1 && s[0] === "'" && FORMULA.test(s.slice(1)) ? s.slice(1) : s);
