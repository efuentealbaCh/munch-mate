/** Table management helpers (owner's "Mesas" screen). */

/** Same bound as the api's TableDto. */
export const TABLE_LABEL_MAX = 30;

/** Upper bound for "Agregar varias": tables are created one request at a time. */
export const BULK_TABLES_MAX = 50;

/** Customer URL printed in a table's QR (the api builds the same one for the PDF sheet). */
export function tableUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/m/${token}`;
}

export type BulkLabelsResult = { ok: true; labels: string[] } | { ok: false; message: string };

/**
 * Labels for "Agregar varias": prefix "Mesa", from 1 to 10 → "Mesa 1" … "Mesa 10".
 * @returns The labels, or a Spanish message explaining what is wrong with the input.
 */
export function bulkLabels(prefix: string, from: number, to: number): BulkLabelsResult {
  const base = prefix.trim();
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < 0) {
    return { ok: false, message: "Usa números enteros desde 0" };
  }
  if (to < from) return { ok: false, message: "El número final debe ser mayor o igual al inicial" };
  const count = to - from + 1;
  if (count > BULK_TABLES_MAX) return { ok: false, message: `Puedes agregar hasta ${BULK_TABLES_MAX} mesas a la vez` };
  const labels = Array.from({ length: count }, (_, i) => (base ? `${base} ${from + i}` : String(from + i)));
  if (labels.some((label) => label.length > TABLE_LABEL_MAX)) {
    return { ok: false, message: `Cada nombre puede tener hasta ${TABLE_LABEL_MAX} caracteres` };
  }
  return { ok: true, labels };
}

/**
 * Labels that are not taken yet (case- and space-insensitive), so running "Mesa 1…10" twice does not
 * create duplicates. The api allows duplicate labels; this only avoids accidental ones.
 */
export function newLabels(labels: readonly string[], existing: readonly string[]): string[] {
  const normalize = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
  const taken = new Set(existing.map(normalize));
  return labels.filter((label) => !taken.has(normalize(label)));
}
