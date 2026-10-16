"use client";

import {
  type DecorKind,
  FLOOR_LIMITS,
  type FloorCell,
  type FloorLevel,
  type FloorMaterial,
  type FloorPlanView,
  type FloorTableView,
  TABLE_SEATS,
  type TableLayout,
  type TableSeats,
  type TableShape,
} from "@app/types";
import { FLOOR_PLAN_MESSAGES, type FloorPlanProblem, floorPlanProblem, isBlockedMaterial, tableFootprint } from "@app/utils";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChefHatIcon,
  DoorOpenIcon,
  FlowerIcon,
  MapIcon,
  MinusIcon,
  MousePointer2Icon,
  MoveIcon,
  PaintbrushIcon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  ShoppingBagIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  UtensilsIcon,
  WandSparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, type MouseEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSocketEvent } from "@/hooks/use-realtime";
import { floorApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import {
  addFloor,
  DEFAULT_TABLE,
  defaultFloorPlan,
  draftFromView,
  dropAt,
  firstFreeCell,
  firstFreeDecorCell,
  FLOOR_NAME_MESSAGES,
  type FloorDraft,
  type FloorItem,
  type FloorTarget,
  floorConflicts,
  isRefusal,
  itemByKey,
  itemKey,
  itemName,
  paintCells,
  PLACE_REFUSAL_MESSAGES,
  placeDecor,
  placeTable,
  removeDecor,
  removeFloor,
  removeFromPlan,
  removeTable,
  renameFloor,
  resizeArea,
  ROTATE_REFUSAL_MESSAGES,
  rotateTable,
  resizeGrid,
  sameDraft,
  saveInput,
  serviceWarnings,
  tablesOnFloor,
  unplacedTables,
  withTables,
} from "@/lib/floor-editor";
import { DECOR_LABELS, DECOR_ORDER, MATERIAL_LOOKS, MATERIAL_ORDER } from "@/lib/floor-materials";
import { cn } from "@/lib/utils";
import { useRestaurant } from "../../restaurant-context";
import { useRestaurantRealtime } from "../../restaurant-realtime";
import { FloorGrid } from "./floor-grid";
import { DecorIcon, materialStyle } from "./floor-terrain";
import { KitchenTargetSettings } from "./kitchen-target-settings";
import { useFloorDrag } from "./use-floor-drag";
import { useFloorPaint } from "./use-floor-paint";

/** «Mover»: tables, areas and door; «Pintar»: terrain per cell; «Decorar»: purely visual items. */
type Mode = "move" | "paint" | "decor";

const MODES: { mode: Mode; label: string; icon: typeof MousePointer2Icon }[] = [
  { mode: "move", label: "Mover", icon: MousePointer2Icon },
  { mode: "paint", label: "Pintar", icon: PaintbrushIcon },
  { mode: "decor", label: "Decorar", icon: FlowerIcon },
];

/** «Trazo» paints the cells crossed; «Rellenar» the rectangle dragged (also Shift + drag with «Trazo»). */
type Brush = "stroke" | "fill";

type Tool = "select" | "table" | "kitchen" | "pickup" | "door";

/** Tools for things that live only on the first floor. */
const GROUND_TOOLS: ReadonlySet<Tool> = new Set(["kitchen", "pickup", "door"]);

const TOOLS: { tool: Tool; label: string; icon: typeof MousePointer2Icon }[] = [
  { tool: "select", label: "Seleccionar", icon: MousePointer2Icon },
  { tool: "table", label: "Mesa", icon: UtensilsIcon },
  { tool: "kitchen", label: "Cocina", icon: ChefHatIcon },
  { tool: "pickup", label: "Retiro", icon: ShoppingBagIcon },
  { tool: "door", label: "Puerta", icon: DoorOpenIcon },
];

const NO_CONFLICTS = { cells: new Set<string>(), items: new Set<string>() };

/** «Mesas → Plano del local» (owner): where the tables, the kitchen, the pickup counter and the delivery door are. */
export function FloorPlanPage() {
  const { restaurant, isOwner } = useRestaurant();
  if (!isOwner) {
    return <AccessDenied restaurantId={restaurant.id} description="Solo los dueños pueden dibujar el plano del local." />;
  }
  return <FloorPlanLoader restaurantId={restaurant.id} />;
}

function FloorPlanLoader({ restaurantId }: { restaurantId: string }) {
  const { data, error, loading, reload } = useApiQuery<FloorPlanView>(
    useCallback(() => floorApi.get(restaurantId), [restaurantId]),
  );
  if (error && !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={error} />
        <Button variant="outline" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if ((loading && !data) || !data) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando plano">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="aspect-[14/9] w-full" />
      </div>
    );
  }
  // From here the editor owns the data: it merges saves, live updates and reconnections itself.
  return <FloorPlanEditor restaurantId={restaurantId} initial={data} />;
}

/** Whether two views from the api are the same (a save of ours echoed back by `floor-plan.updated`). */
const sameView = (a: FloorPlanView, b: FloorPlanView) => JSON.stringify(a) === JSON.stringify(b);

function FloorPlanEditor({ restaurantId, initial }: { restaurantId: string; initial: FloorPlanView }) {
  const { restaurant, reload: reloadRestaurant } = useRestaurant();
  const { socket, syncCount } = useRestaurantRealtime();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<FloorDraft | null>(() => draftFromView(initial));
  const [mode, setMode] = useState<Mode>("move");
  const [tool, setTool] = useState<Tool>("select");
  /** Floor shown (clamped below: a plan loaded from another device may have fewer floors). */
  const [floorIndex, setFloorIndex] = useState(0);
  const [material, setMaterial] = useState<FloorMaterial>("wood");
  const [brush, setBrush] = useState<Brush>("stroke");
  const [decorKind, setDecorKind] = useState<DecorKind>("plant");
  const [floorToDelete, setFloorToDelete] = useState<number | null>(null);
  const [selection, setSelection] = useState<FloorItem | null>(null);
  /** «Mover»: the next tap on the grid is the selection's new place. */
  const [moving, setMoving] = useState(false);
  const [pendingTableId, setPendingTableId] = useState<string | null>(null);
  /** A plan saved from another device while this one had unsaved changes. */
  const [remote, setRemote] = useState<FloorPlanView | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sizeMessage, setSizeMessage] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const tables = saved.tables;
  const savedDraft = useMemo(() => draftFromView(saved), [saved]);
  const dirty = !sameDraft(draft, savedDraft, tables);
  const suspended = restaurant.status === "suspended";

  /** Replaces everything with a view from the api (after saving, or loading another device's plan). */
  const load = useCallback((view: FloorPlanView) => {
    setSaved(view);
    setDraft(draftFromView(view));
    setRemote(null);
    setSelection(null);
    setMoving(false);
    setPendingTableId(null);
    setSizeMessage(null);
  }, []);

  /** A view that arrived without being asked for (live event, reconnection). */
  const receive = (view: FloorPlanView) => {
    if (sameView(view, saved)) return;
    // Our own save, echoed before its response arrived: nothing to warn about.
    if (sameDraft(draftFromView(view), draft, view.tables)) {
      setSaved(view);
      return;
    }
    if (dirty) setRemote(view);
    else load(view);
  };
  const receiveRef = useRef(receive);
  useEffect(() => {
    receiveRef.current = receive;
  });

  useSocketEvent(socket, "floor-plan.updated", (view) => receiveRef.current(view));

  // After a reconnection, events may have been missed: read the plan again (the first subscription is the
  // one this page loaded with).
  const seenSync = useRef(syncCount);
  useEffect(() => {
    if (syncCount === seenSync.current) return;
    seenSync.current = syncCount;
    floorApi.get(restaurantId).then(
      (view) => receiveRef.current(view),
      // Not worth interrupting the owner: the next reconnection or a reload reads it again.
      () => undefined,
    );
  }, [syncCount, restaurantId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need returnValue set to show their "leave site?" dialog.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const cols = draft?.plan.cols ?? FLOOR_LIMITS.colsDefault;
  const rows = draft?.plan.rows ?? FLOOR_LIMITS.rowsDefault;
  const floor = draft ? Math.min(floorIndex, draft.plan.floors.length - 1) : 0;
  const ground = floor === 0;
  const problem: FloorPlanProblem | null = draft ? floorPlanProblem(draft.plan, saveInput(draft, tables).tables) : null;
  const conflicts = useMemo(() => (draft ? floorConflicts(draft, floor) : NO_CONFLICTS), [draft, floor]);
  /** Floors with something to fix, marked on their tab (the problem may be on a floor not shown). */
  const floorsInConflict = useMemo(
    () => new Set(draft ? draft.plan.floors.flatMap((_, i) => (floorConflicts(draft, i).items.size > 0 ? [i] : [])) : []),
    [draft],
  );
  const unplaced = draft ? unplacedTables(draft, tables) : [];
  const inactiveUnplaced = tables.filter((t) => !t.active && !draft?.layouts[t.id]);
  const pendingTable = unplaced.find((t) => t.id === pendingTableId) ?? unplaced[0] ?? null;
  const selected = draft && selection ? itemByKey(draft, itemKey(selection), floor) : null;

  /**
   * Puts a target on a cell of the floor shown and selects it.
   * @returns Whether it was placed (a refusal is explained with a toast).
   */
  function commit(target: FloorTarget, cell: FloorCell): boolean {
    if (!draft) return false;
    const { result } = dropAt(draft, target, cell, floor);
    if (isRefusal(result)) {
      toast.error(PLACE_REFUSAL_MESSAGES[result]);
      return false;
    }
    setDraft(result);
    setSelection(target.kind === "new-table" ? { kind: "table", id: target.id } : target);
    setSizeMessage(null);
    return true;
  }

  const { drag, start, cellAt, justDragged } = useFloorDrag(gridRef, cols, rows, (target, cell) => {
    if (commit(target, cell)) {
      setMoving(false);
      if (target.kind === "new-table") {
        setPendingTableId(null);
        if (unplaced.length <= 1) setTool("select");
      }
    }
  });

  /** The draft when the current paint gesture started: every report repaints all its cells over it. */
  const strokeBase = useRef<FloorDraft | null>(null);
  const paint = useFloorPaint(cellAt, (cells, final) => {
    const base = strokeBase.current;
    if (!base) return;
    const result = paintCells(base, floor, cells, material);
    setDraft(result.draft);
    if (!final) return;
    strokeBase.current = null;
    if (result.refused > 0) {
      toast.error(
        material === "void"
          ? "Algunas celdas no se marcaron fuera del local: tienen mesas, áreas, la puerta o decoración encima."
          : "Algunas celdas no se pintaron como muro: tienen mesas, áreas o decoración encima.",
      );
    }
  });

  function onGridPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!draft || mode !== "paint") return;
    strokeBase.current = draft;
    if (!paint.start(event, brush === "fill" || event.shiftKey)) strokeBase.current = null;
  }

  const ghost = useMemo(() => {
    if (paint.fillRect) return { rect: paint.fillRect, ok: true };
    if (!draft || !drag?.cell) return null;
    const { result, rect } = dropAt(draft, drag.source, drag.cell, floor);
    const key = itemKey(drag.source.kind === "new-table" ? { kind: "table", id: drag.source.id } : drag.source);
    // Areas may be dropped over a table, but the preview warns that it will be a conflict.
    return { rect, ok: !isRefusal(result) && !floorConflicts(result, floor).items.has(key) };
  }, [draft, drag, floor, paint.fillRect]);
  const draggingKey = drag ? itemKey(drag.source.kind === "new-table" ? { kind: "table", id: drag.source.id } : drag.source) : null;

  function chooseTool(next: Tool) {
    setTool(next);
    setMoving(false);
    if (next !== "select") setSelection(null);
  }

  function chooseMode(next: Mode) {
    setMode(next);
    setTool("select");
    setSelection(null);
    setMoving(false);
  }

  function chooseFloor(next: number) {
    setFloorIndex(next);
    setSelection(null);
    setMoving(false);
    if (next !== 0 && GROUND_TOOLS.has(tool)) setTool("select");
  }

  /** Puts the chosen decoration on a cell of the floor shown and selects it (a refusal is explained with a toast). */
  function addDecorAt(cell: FloorCell) {
    if (!draft) return;
    const result = placeDecor(draft, floor, decorKind, cell);
    if (isRefusal(result)) {
      toast.error(PLACE_REFUSAL_MESSAGES[result]);
      return;
    }
    setDraft(result);
    setSelection({ kind: "decor", index: (result.plan.floors[floor]?.decor.length ?? 1) - 1 });
  }

  function placeDecorFreely() {
    if (!draft) return;
    const cell = firstFreeDecorCell(draft, floor);
    if (!cell) toast.error("No queda espacio libre en este piso.");
    else addDecorAt(cell);
  }

  function removeSelectedDecor() {
    if (!draft || selection?.kind !== "decor") return;
    setDraft(removeDecor(draft, floor, selection.index));
    setSelection(null);
  }

  function onGridClick(event: MouseEvent<HTMLDivElement>) {
    // A tap while painting already painted its cell on pointer down.
    if (!draft || justDragged.current || mode === "paint") return;
    const key = (event.target as HTMLElement).closest<HTMLElement>("[data-item]")?.dataset.item;
    const item = key ? (itemByKey(draft, key, floor)?.item ?? null) : null;
    // detail 0 = a click from the keyboard (Enter/Space on an item): no pointer position.
    const cell = event.detail === 0 ? null : cellAt(event.clientX, event.clientY);
    if (mode === "decor") {
      if (item?.kind === "decor" || !cell) setSelection(item?.kind === "decor" ? item : null);
      else addDecorAt(cell);
      return;
    }
    if (moving && selection && cell) {
      if (commit(selection, cell)) setMoving(false);
      return;
    }
    if (tool === "select" || !cell) {
      setSelection(item);
      setMoving(false);
      return;
    }
    if (tool === "table") {
      if (pendingTable && commit({ kind: "new-table", id: pendingTable.id }, cell)) {
        setPendingTableId(null);
        if (unplaced.length <= 1) setTool("select");
      }
      return;
    }
    if (commit({ kind: tool }, cell)) setTool("select");
  }

  function placeFreely() {
    if (!draft || !pendingTable) return;
    const cell = firstFreeCell(draft, pendingTable.id, DEFAULT_TABLE, floor);
    if (!cell) {
      toast.error("No queda espacio libre: agranda el plano o mueve algo.");
      return;
    }
    if (commit({ kind: "new-table", id: pendingTable.id }, cell)) {
      setPendingTableId(null);
      if (unplaced.length <= 1) setTool("select");
    }
  }

  function nudge(dx: number, dy: number) {
    if (!selection || !selected) return;
    commit(selection, { x: selected.rect.x + dx, y: selected.rect.y + dy });
  }

  function changeTable(id: string, layout: TableLayout, change: Partial<Pick<TableLayout, "shape" | "seats">>) {
    if (!draft) return;
    // The current orientation decides where the second cell of a long table goes (beside it or below it).
    const next = { ...layout, ...change };
    const result = placeTable(draft, id, next);
    if (isRefusal(result)) {
      const grown = tableFootprint(next);
      const before = tableFootprint(layout);
      toast.error(
        grown.w * grown.h > before.w * before.h
          ? `Una mesa de ${next.seats} puestos ocupa 2 celdas y la ${grown.h > 1 ? "de abajo" : "de al lado"} no está libre. Muévela a un lugar con espacio o gírala.`
          : PLACE_REFUSAL_MESSAGES[result],
      );
      return;
    }
    setDraft(result);
  }

  /** «Rotar» (or the R key): turns the selected table a quarter, refused with a toast when it does not fit. */
  function rotateSelected() {
    if (!draft || selection?.kind !== "table" || !draft.layouts[selection.id]) return;
    const result = rotateTable(draft, selection.id);
    if (isRefusal(result)) {
      toast.error(ROTATE_REFUSAL_MESSAGES[result === "out_of_bounds" || result === "blocked" ? result : "taken"]);
      return;
    }
    setDraft(result);
  }
  const decorSelected = selection?.kind === "decor";
  const shortcutsRef = useRef({ rotate: rotateSelected, removeDecor: removeSelectedDecor, decorSelected });
  useEffect(() => {
    shortcutsRef.current = { rotate: rotateSelected, removeDecor: removeSelectedDecor, decorSelected };
  });

  // Keyboard shortcuts: R turns the selected table, Supr/Backspace removes the selected decoration; never while
  // typing in a field or with a modifier (Ctrl+R reloads).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const rotate = event.key === "r" || event.key === "R";
      const remove = event.key === "Delete" || event.key === "Backspace";
      // Backspace keeps its usual meaning unless a decoration is selected.
      if (!rotate && !(remove && shortcutsRef.current.decorSelected)) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault();
      if (rotate) shortcutsRef.current.rotate();
      else shortcutsRef.current.removeDecor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function setGridSize(nextCols: number, nextRows: number) {
    if (!draft) return;
    const result = resizeGrid(draft, nextCols, nextRows);
    if ("blockedBy" in result) {
      const item = result.blockedBy;
      const where = result.floor > 0 ? ` (${draft.plan.floors[result.floor]?.name ?? "otro piso"})` : "";
      setSizeMessage(`Para achicar el plano, primero mueve ${itemName(item, tables)}${where} hacia adentro: quedaría fuera.`);
      // Show the floor where it is, selected, so «Mover» is at hand.
      setMode("move");
      setTool("select");
      setFloorIndex(result.floor);
      setSelection(item);
      return;
    }
    setSizeMessage(null);
    setDraft(result);
  }

  function discard() {
    setDraft(savedDraft);
    setSelection(null);
    setMoving(false);
    setSizeMessage(null);
    setRemote(null);
  }

  async function save(next: FloorDraft | null) {
    setSaving(true);
    try {
      load(await floorApi.save(restaurantId, saveInput(next, tables)));
      toast.success(next ? "Plano guardado" : "Plano borrado");
      return true;
    } catch (failure) {
      if (hasCode(failure, "INVALID_FLOOR_PLAN")) {
        const reported = failure.meta?.problem;
        toast.error(reported && reported in FLOOR_PLAN_MESSAGES ? FLOOR_PLAN_MESSAGES[reported as FloorPlanProblem] : errorMessage(failure));
      } else if (hasCode(failure, "UNKNOWN_TABLE")) {
        // A table was deleted meanwhile: refresh the list and keep the owner's edits for the others.
        toast.error("Una mesa se eliminó mientras editabas. Actualizamos la lista: revisa el plano y guarda otra vez.");
        try {
          const fresh = await floorApi.get(restaurantId);
          setSaved(fresh);
          setDraft((current) => (current ? withTables(current, fresh.tables) : current));
          setSelection(null);
        } catch (reloadFailure) {
          toast.error(errorMessage(reloadFailure));
        }
      } else {
        toast.error(errorMessage(failure));
        // Lost the owner role meanwhile: reload so the page shows the access notice.
        if (hasCode(failure, "FORBIDDEN_ROLE")) reloadRestaurant();
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  const activeCount = tables.filter((t) => t.active).length;
  const warnings = draft ? serviceWarnings(restaurant, draft.plan) : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
          <Link href={`/admin/${restaurantId}/mesas`}>
            <ArrowLeftIcon aria-hidden data-icon="inline-start" />
            Mesas
          </Link>
        </Button>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">Plano del local</h2>
          <p className="text-sm text-muted-foreground">
            Ubica tus mesas, la cocina, el retiro y la puerta de delivery. Se usa en la vista En vivo.
          </p>
        </div>
      </div>

      {remote ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground sm:flex-row sm:items-center" data-testid="floor-remote-change">
          <p className="flex-1">
            <strong>Otro dispositivo cambió el plano.</strong> Si guardas, tus cambios reemplazan los suyos.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => load(remote)}>
              Cargar el plano nuevo
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSaved(remote);
                setDraft((current) => (current ? withTables(current, remote.tables) : current));
                setRemote(null);
              }}
            >
              Seguir con mis cambios
            </Button>
          </div>
        </div>
      ) : null}

      {!draft ? (
        <EmptyPlan
          activeCount={activeCount}
          pickup={restaurant.pickupEnabled}
          delivery={restaurant.deliveryEnabled}
          disabled={suspended}
          onCreate={() => {
            setDraft(defaultFloorPlan(restaurant, tables));
            setTool("select");
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div className="flex min-w-0 flex-col gap-3">
            <FloorTabs
              floors={draft.plan.floors}
              current={floor}
              inConflict={floorsInConflict}
              onSelect={chooseFloor}
              onAdd={() => {
                const next = addFloor(draft);
                if (!next) return;
                setDraft(next);
                chooseFloor(next.plan.floors.length - 1);
              }}
              onRename={(name) => {
                const result = renameFloor(draft, floor, name);
                if (typeof result === "string") return FLOOR_NAME_MESSAGES[result];
                setDraft(result);
                return null;
              }}
              onDelete={() => setFloorToDelete(floor)}
            />

            <div role="radiogroup" aria-label="Modo de edición" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              {MODES.map(({ mode: value, label, icon: Icon }) => (
                <Button
                  key={value}
                  type="button"
                  role="radio"
                  size="sm"
                  aria-checked={mode === value}
                  variant={mode === value ? "default" : "ghost"}
                  data-testid={`floor-mode-${value}`}
                  onClick={() => mode !== value && chooseMode(value)}
                >
                  <Icon aria-hidden data-icon="inline-start" />
                  {label}
                </Button>
              ))}
            </div>

            {mode === "move" ? (
              <div role="radiogroup" aria-label="Herramienta" className="grid grid-cols-5 gap-1.5">
                {TOOLS.map(({ tool: value, label, icon: Icon }) => {
                  const checked = tool === value;
                  const disabled = (value === "table" && unplaced.length === 0) || (!ground && GROUND_TOOLS.has(value));
                  return (
                    <Button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      variant={checked ? "default" : "outline"}
                      disabled={disabled}
                      title={!ground && GROUND_TOOLS.has(value) ? "Está en el primer piso" : undefined}
                      className="h-auto flex-col gap-1 px-1 py-2 text-xs"
                      onClick={() => chooseTool(value)}
                    >
                      <Icon aria-hidden className="size-4" />
                      {label}
                    </Button>
                  );
                })}
              </div>
            ) : null}

            {mode === "paint" ? (
              <div className="flex flex-col gap-2">
                <div role="radiogroup" aria-label="Material" className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                  {MATERIAL_ORDER.map((value) => {
                    const look = MATERIAL_LOOKS[value];
                    const checked = material === value;
                    return (
                      <Button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        variant={checked ? "default" : "outline"}
                        title={look.hint}
                        data-testid={`material-${value}`}
                        className="h-auto flex-col gap-1 px-1 py-1.5 text-xs"
                        onClick={() => setMaterial(value)}
                      >
                        <span aria-hidden className="size-6 rounded-sm ring-1 ring-foreground/20" style={materialStyle(value)} />
                        {look.label}
                      </Button>
                    );
                  })}
                </div>
                <ChoiceGroup<Brush>
                  label="Pincel"
                  value={brush}
                  options={[
                    ["stroke", "Trazo"],
                    ["fill", "Rellenar"],
                  ]}
                  onChange={setBrush}
                />
              </div>
            ) : null}

            {mode === "decor" ? (
              <div role="radiogroup" aria-label="Decoración" className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                {DECOR_ORDER.map((value) => {
                  const checked = decorKind === value;
                  return (
                    <Button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      variant={checked ? "default" : "outline"}
                      data-testid={`decor-${value}`}
                      className="h-auto flex-col gap-1 px-1 py-1.5 text-xs"
                      onClick={() => setDecorKind(value)}
                    >
                      <span aria-hidden className="size-7 rounded-sm bg-background p-0.5 ring-1 ring-foreground/10">
                        <DecorIcon kind={value} className="size-full" />
                      </span>
                      {DECOR_LABELS[value]}
                    </Button>
                  );
                })}
              </div>
            ) : null}

            <ToolHint
              mode={mode}
              tool={tool}
              ground={ground}
              moving={moving}
              selectionName={selection ? nameOf(selection, tables) : null}
              pendingLabel={pendingTable?.label ?? null}
              materialLabel={MATERIAL_LOOKS[material].label}
              blockedMaterial={isBlockedMaterial(material)}
              brush={brush}
              decorLabel={DECOR_LABELS[decorKind]}
              onCancelMove={() => setMoving(false)}
              onPlaceFreely={placeFreely}
              onPlaceDecorFreely={placeDecorFreely}
            />

            <FloorGrid
              draft={draft}
              floor={floor}
              tables={tables}
              selection={selection}
              conflicts={conflicts}
              edgeHighlight={ground && mode === "move" && (tool === "door" || (moving && selection?.kind === "door") || drag?.source.kind === "door")}
              ghost={ghost}
              draggingKey={draggingKey}
              interaction={mode === "move" ? "plan" : mode === "decor" ? "decor" : "none"}
              draggable={tool === "select" && !moving}
              gridRef={gridRef}
              onGridClick={onGridClick}
              onGridPointerDown={mode === "paint" ? onGridPointerDown : undefined}
              onItemPointerDown={(item, origin, event) => start(item, origin, event)}
            />
          </div>

          <div className="flex flex-col gap-4">
            {selection?.kind === "decor" && selected ? (
              <DecorPanel
                label={DECOR_LABELS[draft.plan.floors[floor]?.decor[selection.index]?.kind ?? "plant"]}
                onNudge={nudge}
                onRemove={removeSelectedDecor}
                onClose={() => setSelection(null)}
              />
            ) : selection && selected ? (
              <SelectionPanel
                item={selection}
                tables={tables}
                draft={draft}
                moving={moving}
                onMove={() => setMoving((on) => !on)}
                onNudge={nudge}
                onTable={changeTable}
                onRotate={rotateSelected}
                onResize={(area, w, h) => setDraft(resizeArea(draft, area, w, h))}
                onRemove={() => {
                  if (selection.kind === "table") setDraft(removeTable(draft, selection.id));
                  else if (selection.kind === "pickup" || selection.kind === "door") setDraft(removeFromPlan(draft, selection.kind));
                  setSelection(null);
                  setMoving(false);
                }}
                onClose={() => {
                  setSelection(null);
                  setMoving(false);
                }}
              />
            ) : null}

            <section aria-labelledby="unplaced-title" className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
              <h3 id="unplaced-title" className="text-sm font-semibold">
                Sin ubicar
              </h3>
              {tables.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Todavía no tienes mesas.{" "}
                  <Link href={`/admin/${restaurantId}/mesas`} className="font-medium text-primary underline-offset-4 hover:underline">
                    Créalas en Mesas
                  </Link>{" "}
                  y vuelve para ubicarlas.
                </p>
              ) : unplaced.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todas las mesas activas están en el plano.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Arrastra una mesa al plano, o tócala y luego toca una celda libre.</p>
              )}
              {unplaced.length + inactiveUnplaced.length > 0 ? (
                <ul className="flex flex-wrap gap-2" aria-label="Mesas sin ubicar">
                  {unplaced.map((table) => {
                    const chosen = tool === "table" && pendingTable?.id === table.id;
                    return (
                      <li key={table.id}>
                        <button
                          type="button"
                          data-testid="unplaced-table"
                          aria-pressed={chosen}
                          className={cn(
                            "min-h-10 cursor-grab touch-none rounded-md border px-3 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
                            chosen ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                          )}
                          onPointerDown={(event) => start({ kind: "new-table", id: table.id }, null, event)}
                          onClick={() => {
                            if (justDragged.current) return;
                            setMode("move");
                            setTool("table");
                            setPendingTableId(table.id);
                            setSelection(null);
                            setMoving(false);
                          }}
                        >
                          {table.label}
                        </button>
                      </li>
                    );
                  })}
                  {inactiveUnplaced.map((table) => (
                    <li key={table.id}>
                      <span
                        className="inline-flex min-h-10 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground"
                        title="Actívala en Mesas para ubicarla"
                      >
                        {table.label} · inactiva
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section aria-labelledby="grid-size-title" className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
              <h3 id="grid-size-title" className="text-sm font-semibold">
                Tamaño del plano
              </h3>
              <div className="flex flex-wrap gap-4">
                <Stepper
                  label="Columnas"
                  value={draft.plan.cols}
                  min={FLOOR_LIMITS.colsMin}
                  max={FLOOR_LIMITS.colsMax}
                  onChange={(value) => setGridSize(value, draft.plan.rows)}
                />
                <Stepper
                  label="Filas"
                  value={draft.plan.rows}
                  min={FLOOR_LIMITS.rowsMin}
                  max={FLOOR_LIMITS.rowsMax}
                  onChange={(value) => setGridSize(draft.plan.cols, value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">Al achicar se quita la última columna o fila.</p>
              <p className="text-sm text-destructive empty:hidden" aria-live="polite" data-testid="grid-size-message">
                {sizeMessage}
              </p>
            </section>

            {warnings.length > 0 ? (
              <ul className="flex flex-col gap-2" aria-label="Avisos del plano">
                {warnings.map((warning) => (
                  <li key={warning} className="flex gap-2 rounded-lg border border-warning-foreground/30 bg-warning p-3 text-sm text-warning-foreground">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}

      {draft || dirty ? (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center">
          <p
            className={cn("flex-1 text-sm", problem ? "text-destructive" : "text-muted-foreground")}
            aria-live="polite"
            data-testid="floor-status"
          >
            {problem
              ? FLOOR_PLAN_MESSAGES[problem]
              : suspended
                ? "El restaurante está suspendido: no puedes guardar cambios."
                : dirty
                  ? "Tienes cambios sin guardar."
                  : "Plano guardado."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={discard} disabled={!dirty || saving}>
              <Undo2Icon aria-hidden data-icon="inline-start" />
              Descartar cambios
            </Button>
            <Button
              onClick={() => void save(draft)}
              disabled={!dirty || problem !== null || saving || suspended}
              aria-busy={saving || undefined}
              data-testid="save-floor-plan"
            >
              {saving ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              Guardar plano
            </Button>
          </div>
        </div>
      ) : null}

      <section aria-labelledby="kitchen-target-title" className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h3 id="kitchen-target-title" className="font-semibold">
          Meta de cocina
        </h3>
        <KitchenTargetSettings />
      </section>

      {saved.plan ? (
        <div className="flex flex-col items-start gap-2">
          <Button variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={saving || suspended}>
            <Trash2Icon aria-hidden data-icon="inline-start" />
            Borrar plano
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Borrar el plano del local?"
        description="Se borran la cocina, el mesón de retiro, la puerta y el lugar de todas las mesas. Las mesas y sus códigos QR no cambian. La vista En vivo quedará sin salón hasta que dibujes uno nuevo."
        confirmLabel="Borrar plano"
        destructive
        pending={saving}
        onConfirm={() => {
          void save(null).then(() => setConfirmDelete(false));
        }}
      />

      <ConfirmDialog
        open={floorToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setFloorToDelete(null);
        }}
        title={`¿Borrar «${(floorToDelete !== null && draft?.plan.floors[floorToDelete]?.name) || "este piso"}»?`}
        description={floorDeleteText(draft && floorToDelete !== null ? tablesOnFloor(draft, floorToDelete).length : 0)}
        confirmLabel="Borrar piso"
        destructive
        onConfirm={() => {
          if (draft && floorToDelete !== null) {
            setDraft(removeFloor(draft, floorToDelete));
            chooseFloor(Math.max(0, floorToDelete - 1));
          }
          setFloorToDelete(null);
        }}
      />
    </div>
  );
}

function nameOf(item: FloorItem, tables: readonly FloorTableView[]): string {
  switch (item.kind) {
    case "kitchen":
      return "Cocina";
    case "pickup":
      return "Mesón de retiro";
    case "door":
      return "Puerta de delivery";
    case "table":
      return tables.find((t) => t.id === item.id)?.label ?? "Mesa";
    case "decor":
      return "Decoración";
  }
}

/** What deleting a floor does to its tables (the change waits for «Guardar plano», like every other edit). */
function floorDeleteText(tableCount: number): string {
  const tablesText =
    tableCount === 0 ? "" : tableCount === 1 ? " Su mesa vuelve a «Sin ubicar»." : ` Sus ${tableCount} mesas vuelven a «Sin ubicar».`;
  return `Se borran su terreno pintado y su decoración.${tablesText} El cambio queda hecho cuando guardes el plano.`;
}

/**
 * The floor selector above the grid: one button per floor (a dot marks floors with something to fix), «+ Piso»,
 * and for the floor shown «Renombrar» (inline: Enter saves, Escape cancels) and «Borrar piso» (not the first one).
 */
function FloorTabs({
  floors,
  current,
  inConflict,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  floors: readonly FloorLevel[];
  current: number;
  inConflict: ReadonlySet<number>;
  onSelect(floor: number): void;
  onAdd(): void;
  /** @returns The error to show, or null when renamed. */
  onRename(name: string): string | null;
  onDelete(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  function startEditing() {
    setName(floors[current]?.name ?? "");
    setError(null);
    setEditing(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = onRename(name);
    if (problem) setError(problem);
    else setEditing(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="radiogroup" aria-label="Piso" className="flex flex-wrap gap-1.5">
          {floors.map((level, i) => (
            <Button
              key={i}
              type="button"
              size="sm"
              role="radio"
              aria-checked={current === i}
              variant={current === i ? "default" : "outline"}
              data-testid="floor-tab"
              onClick={() => {
                if (current === i) return;
                setEditing(false);
                onSelect(i);
              }}
            >
              <span className="max-w-40 truncate">{level.name}</span>
              {inConflict.has(i) ? (
                <>
                  <span aria-hidden className="size-2 rounded-full bg-destructive" />
                  <span className="sr-only">, tiene elementos por corregir</span>
                </>
              ) : null}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false);
            onAdd();
          }}
          disabled={floors.length >= FLOOR_LIMITS.floorsMax}
          title={floors.length >= FLOOR_LIMITS.floorsMax ? `Hasta ${FLOOR_LIMITS.floorsMax} pisos` : undefined}
          data-testid="add-floor"
        >
          <PlusIcon aria-hidden data-icon="inline-start" />
          Piso
        </Button>
      </div>

      {editing ? (
        <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
          <label htmlFor={inputId} className="sr-only">
            Nombre del piso
          </label>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Input
              id={inputId}
              value={name}
              maxLength={FLOOR_LIMITS.floorNameMax}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
              }}
            />
            {error ? (
              <p id={errorId} className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <Button type="submit" size="sm">
            Listo
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={startEditing} data-testid="rename-floor">
            <PencilIcon aria-hidden data-icon="inline-start" />
            Renombrar
          </Button>
          {current > 0 ? (
            <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={onDelete} data-testid="delete-floor">
              <Trash2Icon aria-hidden data-icon="inline-start" />
              Borrar piso
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The selected decoration: move it one cell, or take it off (also Supr). */
function DecorPanel({
  label,
  onNudge,
  onRemove,
  onClose,
}: {
  label: string;
  onNudge(dx: number, dy: number): void;
  onRemove(): void;
  onClose(): void;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-xl bg-card p-3 ring-1 ring-primary/40" data-testid="floor-decor-selection">
      <div className="flex items-center gap-2">
        <h3 id={titleId} className="flex-1 font-semibold">
          {label}
        </h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Listo
        </Button>
      </div>
      <NudgeButtons onNudge={onNudge} />
      <p className="text-xs text-muted-foreground">Arrástrala para moverla. La decoración solo se ve en el plano: no afecta los pedidos.</p>
      <Button variant="outline" className="self-start text-destructive" onClick={onRemove} aria-keyshortcuts="Delete">
        <Trash2Icon aria-hidden data-icon="inline-start" />
        Quitar
      </Button>
    </section>
  );
}

/** Arrows that move the selection one cell. */
function NudgeButtons({ onNudge }: { onNudge(dx: number, dy: number): void }) {
  return (
    <div role="group" aria-label="Mover una celda" className="grid w-fit grid-cols-4 gap-1">
      <Button size="icon" variant="outline" aria-label="Mover a la izquierda" onClick={() => onNudge(-1, 0)}>
        <ArrowLeftIcon aria-hidden />
      </Button>
      <Button size="icon" variant="outline" aria-label="Mover hacia arriba" onClick={() => onNudge(0, -1)}>
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button size="icon" variant="outline" aria-label="Mover hacia abajo" onClick={() => onNudge(0, 1)}>
        <ArrowDownIcon aria-hidden />
      </Button>
      <Button size="icon" variant="outline" aria-label="Mover a la derecha" onClick={() => onNudge(1, 0)}>
        <ArrowRightIcon aria-hidden />
      </Button>
    </div>
  );
}

function EmptyPlan({
  activeCount,
  pickup,
  delivery,
  disabled,
  onCreate,
}: {
  activeCount: number;
  pickup: boolean;
  delivery: boolean;
  disabled: boolean;
  onCreate(): void;
}) {
  const parts = ["la cocina", ...(pickup ? ["el mesón de retiro"] : []), ...(delivery ? ["la puerta de delivery"] : [])];
  const zones = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}` : parts[0];
  const tablesText = activeCount === 0 ? "" : activeCount === 1 ? " y tu mesa activa" : ` y tus ${activeCount} mesas activas`;
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-10 text-center">
      <MapIcon className="size-10 text-muted-foreground" aria-hidden />
      <div className="flex max-w-md flex-col gap-1">
        <h3 className="text-lg font-semibold">Todavía no dibujas el plano del local</h3>
        <p className="text-sm text-muted-foreground">
          Armamos uno con {zones}
          {tablesText}. Después lo ajustas a tu gusto y lo guardas.
        </p>
      </div>
      <Button onClick={onCreate} disabled={disabled} data-testid="create-floor-plan">
        <WandSparklesIcon aria-hidden data-icon="inline-start" />
        Crear plano
      </Button>
    </div>
  );
}

function ToolHint({
  mode,
  tool,
  ground,
  moving,
  selectionName,
  pendingLabel,
  materialLabel,
  blockedMaterial,
  brush,
  decorLabel,
  onCancelMove,
  onPlaceFreely,
  onPlaceDecorFreely,
}: {
  mode: Mode;
  tool: Tool;
  /** The first floor is shown (the only one with kitchen, counter and door). */
  ground: boolean;
  moving: boolean;
  selectionName: string | null;
  pendingLabel: string | null;
  materialLabel: string;
  /** Wall or void: cells under tables, areas or decorations are skipped. */
  blockedMaterial: boolean;
  brush: Brush;
  decorLabel: string;
  onCancelMove(): void;
  onPlaceFreely(): void;
  onPlaceDecorFreely(): void;
}) {
  let text: ReactNode;
  let action: ReactNode = null;
  if (mode === "paint") {
    text =
      brush === "fill"
        ? `Arrastra de una esquina a la otra para rellenar un rectángulo con «${materialLabel}».`
        : `Toca o arrastra sobre el plano para pintar con «${materialLabel}». Con Shift + arrastrar rellenas un rectángulo.`;
    if (blockedMaterial) text = `${text} No cubre las celdas con mesas, áreas o decoración.`;
  } else if (mode === "decor") {
    text = `Toca una celda libre para poner «${decorLabel}». Toca una decoración para elegirla, o arrástrala para moverla.`;
    action = (
      <Button size="sm" variant="outline" onClick={onPlaceDecorFreely}>
        Poner en un lugar libre
      </Button>
    );
  } else if (moving && selectionName) {
    text = `Toca la celda donde va «${selectionName}».`;
    action = (
      <Button size="sm" variant="outline" onClick={onCancelMove}>
        Cancelar
      </Button>
    );
  } else if (tool === "table") {
    text = pendingLabel ? `Toca una celda libre para ubicar «${pendingLabel}».` : "Todas las mesas activas están en el plano.";
    if (pendingLabel) {
      action = (
        <Button size="sm" variant="outline" onClick={onPlaceFreely}>
          Ubicar en un lugar libre
        </Button>
      );
    }
  } else if (tool === "kitchen") {
    text = "Toca la celda donde va la esquina superior izquierda de la cocina.";
  } else if (tool === "pickup") {
    text = "Toca la celda donde va la esquina superior izquierda del mesón de retiro.";
  } else if (tool === "door") {
    text = "Toca una celda del borde (marcadas en azul) para poner la puerta de delivery.";
  } else {
    text = ground
      ? "Toca un elemento para editarlo, o arrástralo para moverlo."
      : "Toca una mesa para editarla, o arrástrala para moverla. La cocina, el retiro y la puerta de delivery están en el primer piso.";
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite" data-testid="floor-hint">
      <p className="flex-1">{text}</p>
      {action}
    </div>
  );
}

function SelectionPanel({
  item,
  tables,
  draft,
  moving,
  onMove,
  onNudge,
  onTable,
  onRotate,
  onResize,
  onRemove,
  onClose,
}: {
  item: FloorItem;
  tables: readonly FloorTableView[];
  draft: FloorDraft;
  moving: boolean;
  onMove(): void;
  onNudge(dx: number, dy: number): void;
  onTable(id: string, layout: TableLayout, change: Partial<Pick<TableLayout, "shape" | "seats">>): void;
  onRotate(): void;
  onResize(area: "kitchen" | "pickup", w: number, h: number): void;
  onRemove(): void;
  onClose(): void;
}) {
  const titleId = useId();
  const table = item.kind === "table" ? tables.find((t) => t.id === item.id) : undefined;
  const layout = item.kind === "table" ? draft.layouts[item.id] : null;
  const area = item.kind === "kitchen" || item.kind === "pickup" ? draft.plan[item.kind] : null;

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-xl bg-card p-3 ring-1 ring-primary/40" data-testid="floor-selection">
      <div className="flex items-center gap-2">
        <h3 id={titleId} className="flex-1 font-semibold break-words">
          {nameOf(item, tables)}
        </h3>
        {table && !table.active ? <Badge variant="outline">Inactiva</Badge> : null}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Listo
        </Button>
      </div>
      {table && !table.active ? (
        <p className="text-xs text-muted-foreground">Las mesas inactivas no se muestran en la vista En vivo, pero conservan su lugar.</p>
      ) : null}

      {item.kind === "table" && layout ? (
        <>
          <ChoiceGroup<TableShape>
            label="Forma"
            value={layout.shape}
            options={[
              ["round", "Redonda"],
              ["square", "Cuadrada"],
            ]}
            onChange={(shape) => onTable(item.id, layout, { shape })}
          />
          <ChoiceGroup<TableSeats>
            label="Puestos"
            value={layout.seats}
            options={TABLE_SEATS.map((seats) => [seats, String(seats)] as const)}
            onChange={(seats) => onTable(item.id, layout, { seats })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onRotate} aria-keyshortcuts="R" data-testid="rotate-table">
              <RotateCwIcon aria-hidden data-icon="inline-start" />
              Rotar
            </Button>
            <span className="text-sm text-muted-foreground" data-testid="table-orientation">
              {layout.rotation === 90 ? "Vertical" : "Horizontal"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Las mesas de 6 y 8 puestos ocupan 2 celdas: una al lado de la otra, o una bajo la otra si la giras. «Rotar» (tecla R) gira la
            mesa en el plano.
          </p>
        </>
      ) : null}

      {area && (item.kind === "kitchen" || item.kind === "pickup") ? (
        <div className="flex flex-wrap gap-4">
          <Stepper label="Ancho" value={area.w} min={FLOOR_LIMITS.areaMin} max={draft.plan.cols} onChange={(w) => onResize(item.kind as "kitchen" | "pickup", w, area.h)} />
          <Stepper label="Alto" value={area.h} min={FLOOR_LIMITS.areaMin} max={draft.plan.rows} onChange={(h) => onResize(item.kind as "kitchen" | "pickup", area.w, h)} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <NudgeButtons onNudge={onNudge} />
        <Button variant={moving ? "default" : "outline"} aria-pressed={moving} onClick={onMove}>
          <MoveIcon aria-hidden data-icon="inline-start" />
          Mover
        </Button>
      </div>

      {item.kind === "door" ? (
        <p className="text-xs text-muted-foreground">La puerta va en el borde del plano: arrástrala o usa «Mover» y toca una celda del borde.</p>
      ) : null}

      {item.kind !== "kitchen" ? (
        <Button variant="outline" className="self-start text-destructive" onClick={onRemove}>
          <Trash2Icon aria-hidden data-icon="inline-start" />
          {item.kind === "table" ? "Quitar del plano" : item.kind === "pickup" ? "Quitar mesón de retiro" : "Quitar puerta"}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">La cocina es obligatoria: muévela o cambia su tamaño.</p>
      )}
    </section>
  );
}

/** Radio buttons as a row of toggle buttons (same pattern as the other admin forms). */
function ChoiceGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange(value: T): void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {options.map(([option, text]) => (
          <Button
            key={String(option)}
            type="button"
            size="sm"
            role="radio"
            aria-checked={value === option}
            variant={value === option ? "default" : "outline"}
            className="min-w-11"
            onClick={() => value !== option && onChange(option)}
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** − n + for a size in cells. */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
        <Button type="button" variant="ghost" size="icon" aria-label={`Menos ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          <MinusIcon aria-hidden />
        </Button>
        <output aria-live="polite" className="min-w-7 text-center font-semibold tabular-nums">
          {value}
        </output>
        <Button type="button" variant="ghost" size="icon" aria-label={`Más ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <PlusIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}
