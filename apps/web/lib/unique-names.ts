import { nameKey } from "@app/utils";
import { hasCode } from "./errors";

/**
 * Names that cannot repeat within a restaurant (the api answers 409 with these codes). Compared with
 * `nameKey` from `@app/utils`, like the api: case, accents and extra spaces do not make a name different.
 */
export type UniqueNameKind = "table" | "zone" | "category" | "product";

export const NAME_TAKEN_CODES = {
  table: "TABLE_LABEL_TAKEN",
  zone: "ZONE_NAME_TAKEN",
  category: "CATEGORY_NAME_TAKEN",
  product: "PRODUCT_NAME_TAKEN",
} as const satisfies Record<UniqueNameKind, string>;

const TAKEN_MESSAGES: Record<UniqueNameKind, (name: string) => string> = {
  table: (name) => `Ya tienes una mesa llamada «${name}»`,
  zone: (name) => `Ya tienes una zona llamada «${name}»`,
  category: (name) => `Ya tienes una categoría llamada «${name}»`,
  product: (name) => `Ya hay un producto llamado «${name}» en esta categoría`,
};

/** Minimal shape of what the screens already have loaded (tables map `label` to `name`). */
export interface NamedItem {
  id: string;
  name: string;
}

/**
 * Checks a name against the list the screen already has, before sending it (the api checks again).
 * @param exceptId The item being edited: it may keep its own name.
 * @returns The Spanish message for the field (quoting the existing item's name as it is written), or null.
 */
export function nameTakenMessage(
  kind: UniqueNameKind,
  name: string,
  existing: readonly NamedItem[],
  exceptId?: string,
): string | null {
  const key = nameKey(name);
  if (key === "") return null;
  // Same rule as the api (isNameTaken): an item may always keep its own name, even an old duplicate.
  const self = exceptId === undefined ? undefined : existing.find((item) => item.id === exceptId);
  if (self && nameKey(self.name) === key) return null;
  const clash = existing.find((item) => item.id !== exceptId && nameKey(item.name) === key);
  return clash ? TAKEN_MESSAGES[kind](clash.name) : null;
}

/**
 * The api's message when it answered 409 for a repeated name (created from another tab meanwhile), so the
 * form can show it on the field; null for any other error.
 */
export function nameTakenFromError(kind: UniqueNameKind, error: unknown): string | null {
  return hasCode(error, NAME_TAKEN_CODES[kind]) ? error.message || TAKEN_MESSAGES[kind]("ese nombre") : null;
}

/** "Agregar varias mesas": which labels of the range will be created and which are skipped. */
export interface BulkTablesPlan {
  create: string[];
  /** Labels already used by a table, or repeated within the range itself. */
  skipped: string[];
}

/** Splits the labels of a range into new ones and those already taken (or repeated among themselves). */
export function planBulkTables(labels: readonly string[], existing: readonly string[]): BulkTablesPlan {
  const taken = new Set(existing.map(nameKey));
  const plan: BulkTablesPlan = { create: [], skipped: [] };
  for (const label of labels) {
    const key = nameKey(label);
    if (taken.has(key)) plan.skipped.push(label);
    else {
      taken.add(key);
      plan.create.push(label);
    }
  }
  return plan;
}

/**
 * Short list for the warning ("Mesa 1, Mesa 2 y 3 más"), so a long range does not flood the dialog.
 * @param max How many names to show before summarizing the rest.
 */
export function listPreview(names: readonly string[], max = 5): string {
  if (names.length <= max) {
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(", ")} y ${names.length - max} más`;
}
