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

/** Outcome of creating the tables of "Agregar varias" one by one. */
export interface BulkCreateResult<T> {
  created: T[];
  /** Labels the api rejected as already taken (created from another tab meanwhile): skipped, not fatal. */
  taken: string[];
  /** First other error: creation stops there (network, permissions…). null when all went through. */
  error: unknown;
}

/**
 * Creates the tables one at a time, in order (the list keeps a natural order and a failure stops cleanly).
 * A label the api says is taken does not cut the batch: it is counted and the next one goes on.
 *
 * @param create Creates one table (the api call).
 * @param isTaken Whether an error means "label already taken" (409 TABLE_LABEL_TAKEN).
 * @param onCreated Called after each table is created (adding it to the list).
 * @param onProgress Called after each label is handled (created or skipped), with how many are done.
 */
export async function createInOrder<T>(
  labels: readonly string[],
  create: (label: string) => Promise<T>,
  isTaken: (error: unknown) => boolean,
  onCreated?: (item: T) => void,
  onProgress?: (done: number) => void,
): Promise<BulkCreateResult<T>> {
  const result: BulkCreateResult<T> = { created: [], taken: [], error: null };
  for (const label of labels) {
    try {
      const item = await create(label);
      result.created.push(item);
      onCreated?.(item);
    } catch (failure) {
      if (!isTaken(failure)) {
        result.error = failure;
        return result;
      }
      result.taken.push(label);
    }
    onProgress?.(result.created.length + result.taken.length);
  }
  return result;
}

/** Tables have a `label`; the shared unique-name rules (`lib/unique-names`) work on `name`. */
export function namedTables(tables: readonly { id: string; label: string }[]): { id: string; name: string }[] {
  return tables.map((table) => ({ id: table.id, name: table.label }));
}
