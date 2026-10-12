/**
 * Comparison key for names that must be unique within a restaurant (tables, delivery zones, categories,
 * products of a category): case, accents and extra spaces do not make a name different, so "Mesa 1",
 * "mesa  1" and "MESA 1" collide, and so do "Ñuñoa" and "Nunoa".
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether `name` is already used by another item of the list.
 * @param exceptId The item being edited. Keeping its own name (even re-cased) is always allowed, so items
 *   that were duplicated before this rule existed can still be edited without renaming them.
 */
export function isNameTaken(
  name: string,
  existing: readonly { id: string; name: string }[],
  exceptId?: string,
): boolean {
  const key = nameKey(name);
  const self = exceptId === undefined ? undefined : existing.find((item) => item.id === exceptId);
  if (self && nameKey(self.name) === key) return false;
  return existing.some((item) => item.id !== exceptId && nameKey(item.name) === key);
}
