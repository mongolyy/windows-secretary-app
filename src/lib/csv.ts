/** RFC 4180-style CSV. Notion wraps fields that contain commas or newlines in double quotes. */

export type CsvTable =
  | { ok: true; rows: string[][] }
  | { ok: false; message: string };

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const flushField = () => {
    row.push(field);
    field = "";
  };
  const flushRow = () => {
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += char;
      continue;
    }

    if (char === '"') {
      if (field.length === 0) {
        inQuotes = true;
        continue;
      }
      field += char;
      continue;
    }
    if (char === ",") {
      flushField();
      continue;
    }
    if (char === "\r" || char === "\n") {
      flushField();
      flushRow();
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      continue;
    }
    field += char;
  }

  if (inQuotes) {
    return { ok: false, message: "CSVの引用符が閉じられていません" };
  }
  if (field.length > 0 || row.length > 0) {
    flushField();
    flushRow();
  }
  return { ok: true, rows };
}
