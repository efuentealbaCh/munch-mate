"use client";

import { MENU_LIMITS, type ModifierGroupView } from "@app/types";
import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { NativeSelect } from "@/components/native-select";
import { ReorderButtons } from "@/components/reorder-buttons";
import { Button } from "@/components/ui/button";
import { modifierRuleSummary, moveItem } from "@/lib/menu";

interface ModifierGroupsPickerProps {
  restaurantId: string;
  groups: readonly ModifierGroupView[];
  /** Selected group ids, in display order. */
  value: string[];
  onChange(ids: string[]): void;
  error?: string;
}

/**
 * Ordered multi-select of modifier groups from the library. The order is the one customers see
 * (e.g. "Tamaño" before "Agregados"), so it is shown as a list with up/down buttons.
 */
export function ModifierGroupsPicker({ restaurantId, groups, value, onChange, error }: ModifierGroupsPickerProps) {
  const id = useId();
  const [pick, setPick] = useState("");
  const byId = new Map(groups.map((group) => [group.id, group]));
  // Ids of groups deleted meanwhile are dropped from the list (the api would reject them).
  const selected = value.filter((groupId) => byId.has(groupId));
  const remaining = groups.filter((group) => !selected.includes(group.id));
  const full = selected.length >= MENU_LIMITS.groupsPerProductMax;

  function add() {
    if (!pick || full) return;
    onChange([...selected, pick]);
    setPick("");
  }

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}>
      <legend className="text-sm font-medium">Grupos de opciones</legend>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        Ej. Tamaño o Agregados. Tus clientes los verán en este orden.
      </p>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Aún no tienes grupos de opciones.{" "}
          <Link href={`/admin/${restaurantId}/menu/modificadores`} className="font-medium text-primary underline-offset-4 hover:underline">
            Créalos en Modificadores
          </Link>
          .
        </p>
      ) : null}

      {selected.length > 0 ? (
        <ol className="flex flex-col divide-y rounded-lg border" aria-label="Grupos elegidos">
          {selected.map((groupId, index) => {
            const group = byId.get(groupId) as ModifierGroupView;
            return (
              <li key={groupId} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{group.name}</span>
                  <span className="text-xs text-muted-foreground">{modifierRuleSummary(group.minSelect, group.maxSelect)}</span>
                </div>
                <ReorderButtons
                  itemName={group.name}
                  index={index}
                  count={selected.length}
                  size="icon-sm"
                  onMove={(delta) => onChange(moveItem(selected, index, index + delta))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quitar ${group.name}`}
                  onClick={() => onChange(selected.filter((other) => other !== groupId))}
                >
                  <XIcon aria-hidden />
                </Button>
              </li>
            );
          })}
        </ol>
      ) : null}

      {remaining.length > 0 && !full ? (
        <div className="flex gap-2">
          <label htmlFor={`${id}-pick`} className="sr-only">
            Grupo para agregar
          </label>
          <NativeSelect id={`${id}-pick`} value={pick} onChange={(event) => setPick(event.target.value)}>
            <option value="">Elige un grupo…</option>
            {remaining.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({modifierRuleSummary(group.minSelect, group.maxSelect)})
              </option>
            ))}
          </NativeSelect>
          <Button type="button" variant="outline" onClick={add} disabled={!pick}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            Agregar
          </Button>
        </div>
      ) : null}
      {full ? (
        <p className="text-sm text-muted-foreground">Llegaste al máximo de {MENU_LIMITS.groupsPerProductMax} grupos por producto.</p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
