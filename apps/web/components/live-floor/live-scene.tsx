"use client";

import type { FloorPlan, OrderView } from "@app/types";
import { type FocusEvent, type KeyboardEvent, memo, type PointerEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ALERT_COLORS,
  artPoint,
  CELL,
  diningLabelSpot,
  doorSide,
  drawnLevel,
  ellipsize,
  fitArt,
  floorEllipse,
  floorRectPath,
  freeCorners,
  type GridRect,
  hasVoid,
  isInside,
  KITCHEN_ART,
  type KitchenGroup,
  type LiveLayout,
  type LiveTarget,
  nameSpot,
  paintOrder,
  parseTarget,
  payingChip,
  PICKUP_ART,
  project,
  r1,
  sceneFrame,
  shortLabel,
  TABLE_COLORS,
  TABLE_SCALE,
  TABLE_STATE_LABELS,
  type TableStatus,
  targetKey,
  terrainRuns,
  TICKET_GROUP,
  timerLabel,
  tone,
  voidEdgeRect,
  voidEdges,
  WALL_HEIGHT,
  wallRuns,
} from "@/lib/live-floor";
import { formatClockTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IsoBox, IsoText, Line3, PALETTE, Plant, Poly, type SceneIds, SceneIdsContext, sceneIds, url } from "./iso-shapes";
import { BAG_X, KITCHEN_ANCHORS, KitchenArt, type MotoFrame, MotoArt, PickupArt, TABLE_TOP_Z, TableArt } from "./scene-art";
import { DecorArt, PLAIN_FLOOR, SlabRuns, TerrainFloor, VoidCurb, WallBlock } from "./terrain-art";

/** What the scene draws: the layout plus the live state of tables, kitchen, counter and riders. */
export interface SceneData {
  layout: LiveLayout;
  restaurantName: string;
  /** By table id; missing = free. */
  tableStates: ReadonlyMap<string, TableStatus>;
  groups: KitchenGroup[];
  /** Pickup orders ready on the counter, oldest first. */
  readyPickups: OrderView[];
  /** Deliveries on their way (one motorbike each). */
  riders: OrderView[];
  /** What the dashed ring marks on the floor. */
  ring: LiveTarget | null;
  /**
   * The plan the drawing's box is computed from: the first floor's (with its door and kitchen), so switching floors
   * does not resize the drawing. Default: `layout.plan`.
   */
  framePlan?: FloorPlan;
}

const MAX_MOTOS = 3;

/** Animations of the mock-up; all of them stop with prefers-reduced-motion. */
const SCENE_CSS = `
.lf-scene [data-id]{cursor:pointer}
.lf-scene [data-id]:focus{outline:none}
.lf-sel{fill:rgba(194,65,12,.07);stroke:#c2410c;stroke-width:2;stroke-dasharray:7 5;animation:lf-march 1.2s linear infinite}
@keyframes lf-march{to{stroke-dashoffset:-24}}
.lf-pulse{transform-box:fill-box;transform-origin:center;animation:lf-pulse 2s ease-out infinite}
@keyframes lf-pulse{0%{transform:scale(1);opacity:.65}100%{transform:scale(2.1);opacity:0}}
.lf-glow{animation:lf-glow 2.4s ease-in-out infinite}
@keyframes lf-glow{0%,100%{opacity:.75}50%{opacity:1}}
.lf-smoke{transform-box:fill-box;transform-origin:center;animation:lf-smoke 4.5s ease-out infinite;opacity:0}
.lf-s2{animation-delay:1.5s}.lf-s3{animation-delay:3s}
@keyframes lf-smoke{0%{transform:translate(0,0) scale(.6);opacity:0}20%{opacity:.55}100%{transform:translate(6px,-30px) scale(1.6);opacity:0}}
.lf-bob{animation:lf-bob 1.1s ease-in-out infinite}
@keyframes lf-bob{50%{transform:translateY(-1px)}}
@media (prefers-reduced-motion:reduce){.lf-pulse,.lf-glow,.lf-smoke,.lf-bob,.lf-sel{animation:none!important}.lf-smoke{opacity:.35}}
`;

/** Accessible, focusable element of the scene: hover, click and Enter select it. */
function hit(target: LiveTarget, label: string, focusable = true) {
  return {
    "data-id": targetKey(target),
    ...(focusable ? { tabIndex: 0, role: "button", "aria-label": label } : {}),
  };
}

/** Center of a table's footprint on the floor (world units): long tables take 2 × 1 or 1 × 2 cells. */
function tableCenter(rect: GridRect): [number, number] {
  return [(rect.x + rect.w / 2) * CELL, (rect.y + rect.h / 2) * CELL];
}

/** Where the motorbikes stand: outside a front door (on the street), inside a back door. */
function motoFrames(layout: LiveLayout, count: number): MotoFrame[] {
  const door = layout.plan.door;
  if (!door) return [];
  const side = doorSide(door, layout.plan.cols, layout.plan.rows);
  const width = layout.plan.cols * CELL;
  const depth = layout.plan.rows * CELL;
  const cx = (door.x + 0.5) * CELL;
  const cy = (door.y + 0.5) * CELL;
  return Array.from({ length: count }, (_, i) => {
    const off = (i - (count - 1) / 2) * 1.9;
    switch (side) {
      case "east":
        return (a, b, z) => [width + a, cy + b + off, z];
      case "south":
        return (a, b, z) => [cx + b + off, depth + a, z];
      case "west":
        return (a, b, z) => [a - 0.9, cy + b + off, z + 1];
      default:
        return (a, b, z) => [cx + b + off, a - 0.9, z + 1];
    }
  });
}

function riderTag(order: OrderView): string {
  const name = order.rider?.name.split(" ")[0] ?? "Reparto";
  return `#${order.ticketNumber} ${ellipsize(name, 10)}${order.estimatedReadyAt ? ` · ${formatClockTime(order.estimatedReadyAt)}` : ""}`;
}

/** The drawing itself. Memoized: hovering (tooltip, highlight) must not redraw a thousand shapes. */
const SceneSvg = memo(function SceneSvg({ data, ids, label }: { data: SceneData; ids: SceneIds; label: string }) {
  const { layout, tableStates, groups, readyPickups, riders, restaurantName, ring } = data;
  const { plan, ground: groundFloor } = layout;
  const frame = sceneFrame(data.framePlan ?? plan);
  const os = frame.overlayScale;
  const W = frame.width;
  const H = frame.depth;
  const kitchenPlace = fitArt(plan.kitchen, KITCHEN_ART, "back");
  const pickupPlace = plan.pickup ? fitArt(plan.pickup, PICKUP_ART, "center") : null;
  const side = plan.door ? doorSide(plan.door, plan.cols, plan.rows) : null;
  const front = side === "east" || side === "south";
  const motos = riders.slice(0, MAX_MOTOS);
  const frames = motoFrames(layout, motos.length);
  const name = nameSpot(plan, layout.floor);
  const corners = freeCorners(plan, layout.tables, layout.floor);
  const diningSpot = layout.dining ? diningLabelSpot(plan, layout.tables, layout.floor) : null;
  const level = drawnLevel(layout);
  const { terrain } = level;
  const inside = (x: number, y: number) => isInside(terrain, plan.cols, { x, y });
  /** Spans (world units) of a row or column of the grid's edge that are inside the building. */
  const insideSpans = (count: number, cellAt: (i: number) => [number, number]): [number, number][] => {
    const spans: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      if (!inside(...cellAt(i))) continue;
      const last = spans.at(-1);
      if (last && last[1] === i * CELL) last[1] = (i + 1) * CELL;
      else spans.push([i * CELL, (i + 1) * CELL]);
    }
    return spans;
  };
  const kitchenCount = groups.reduce((sum, g) => sum + g.tickets.length, 0);

  // ── Ground ──
  const ground: ReactNode[] = [];
  ground.push(
    <Poly key="shadow" points={[[-0.6, -0.6, -1.4], [W + 1.5, -0.6, -1.4], [W + 1.5, H + 1.5, -1.4], [-0.6, H + 1.5, -1.4]]} fill="#6b4f3a" opacity={0.2} filter={url(ids.blur)} />,
  );
  if (plan.door && front) {
    // The street in front of the delivery door, fading out at both ends.
    const east = side === "east";
    const c = east ? (plan.door.y + 0.5) * CELL : (plan.door.x + 0.5) * CELL;
    const from = c - 11;
    const to = c + 9;
    const along = (s: number, t: number, z: number): [number, number, number] => (east ? [W + s, t, z] : [t, H + s, z]);
    ground.push(
      <g key="road" mask={url(ids.roadFade)}>
        <Poly points={[along(0, from, -1), along(1.7, from, -1), along(1.7, to, -1), along(0, to, -1)]} fill="#ebe4dc" />
        <Poly points={[along(1.7, from, -1), along(6.2, from, -1), along(6.2, to, -1), along(1.7, to, -1)]} fill="#ddd5cc" />
        <Line3 from={along(3.95, from, -1)} to={along(3.95, to, -1)} stroke="#ffffff" strokeWidth={1.6} strokeDasharray="7 7" />
      </g>,
    );
  }
  if (hasVoid(terrain)) {
    // Cells outside the building: no slab under them (the whole-plan shadow becomes one per row of the building).
    ground[0] = <SlabRuns key="slab" level={level} cols={plan.cols} rows={plan.rows} />;
  } else {
    ground.push(<IsoBox key="slab" x={-0.6} y={-0.6} z={-1} w={W + 0.6} d={H + 0.6} h={1} c={PALETTE.slab} />);
  }
  if (terrain === null) {
    ground.push(<Poly key="floor" points={[[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]]} fill={layout.dining ? PLAIN_FLOOR.dining : PLAIN_FLOOR.bare} />);
  } else {
    ground.push(<TerrainFloor key="terrain" runs={terrainRuns(terrain, plan.cols, plan.rows)} dining={layout.dining} />);
  }
  if (layout.dining) {
    const planks: ReactNode[] = [];
    // A painted floor draws its own planks (TerrainFloor), only on its plain cells.
    for (let py = 1.75; terrain === null && py < H; py += 1.75) {
      planks.push(<Line3 key={py} from={[0, py, 0]} to={[W, py, 0]} stroke={PLAIN_FLOOR.plank} strokeWidth={0.8} />);
    }
    ground.push(
      <g key="dining" data-testid="live-dining" pointerEvents="none">
        {planks}
        {diningSpot ? (
          <IsoText x={diningSpot.x * CELL + 0.8} y={(diningSpot.y + 1) * CELL - 1.05} plane="floor" fontSize={11} fontWeight={700} letterSpacing={3} fill="#a8927c" opacity={0.75}>
            SALÓN
          </IsoText>
        ) : null}
      </g>,
    );
  }
  // Kitchen floor: light tiles (the kitchen is on the first floor).
  if (groundFloor) {
    const k = plan.kitchen;
    const x0 = k.x * CELL;
    const y0 = k.y * CELL;
    const x1 = (k.x + k.w) * CELL;
    const y1 = (k.y + k.h) * CELL;
    const lines: ReactNode[] = [];
    for (let kx = x0 + 1.75; kx < x1; kx += 1.75) lines.push(<Line3 key={`x${kx}`} from={[kx, y0, 0]} to={[kx, y1, 0]} stroke="#e3e0dc" strokeWidth={0.7} pointerEvents="none" />);
    for (let ky = y0 + 1.75; ky < y1; ky += 1.75) lines.push(<Line3 key={`y${ky}`} from={[x0, ky, 0]} to={[x1, ky, 0]} stroke="#e3e0dc" strokeWidth={0.7} pointerEvents="none" />);
    ground.push(
      <g key="kitchen-floor" data-testid="live-kitchen">
        <Poly className="lf-zone" points={[[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]]} fill="#f3f2f0" {...hit({ kind: "kitchen" }, "", false)} />
        {lines}
        <IsoText x={x0 + 1.6} y={y1 - 0.9} plane="floor" fontSize={10} fontWeight={700} letterSpacing={3} fill="#a8a29e" pointerEvents="none">
          COCINA
        </IsoText>
      </g>,
    );
  }
  if (plan.pickup) {
    const p = plan.pickup;
    const x0 = p.x * CELL;
    const y0 = p.y * CELL;
    const x1 = (p.x + p.w) * CELL;
    const y1 = (p.y + p.h) * CELL;
    ground.push(
      <g key="pickup-floor">
        <Poly className="lf-zone" points={[[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]]} fill="#eee8e1" {...hit({ kind: "pickup" }, "", false)} />
        <IsoText x={x0 + 1.6} y={y1 - 0.9} plane="floor" fontSize={10} fontWeight={700} letterSpacing={3} fill="#a8a29e" pointerEvents="none">
          RETIRO
        </IsoText>
      </g>,
    );
  }

  // ── Floor effects: selection ring and payment rings ──
  const floorfx: ReactNode[] = [];
  for (const table of layout.tables) {
    const state = tableStates.get(table.id);
    if (state?.paidFraction == null) continue;
    const [cx, cy] = tableCenter(table.rect);
    const ringPath = floorEllipse(cx, cy, (table.rect.w * CELL) / 2 - 0.15, (table.rect.h * CELL) / 2 - 0.15);
    floorfx.push(
      <g key={`pay-${table.id}`} pointerEvents="none">
        <path d={ringPath.d} fill="none" stroke="#e2ded9" strokeWidth={4} />
        <path d={ringPath.d} fill="none" stroke={ALERT_COLORS.paying} strokeWidth={4} strokeLinecap="round" strokeDasharray={`${r1(ringPath.length * state.paidFraction)} ${r1(ringPath.length)}`} />
      </g>,
    );
  }
  const selection = ringShape(ring, layout, motos, frames);
  if (selection) floorfx.unshift(<path key="sel" className="lf-sel" d={selection} pointerEvents="none" />);

  // ── Back walls ──
  const walls: ReactNode[] = [];
  // Only along cells inside the building (an unpainted plan: each back edge whole, as one wall).
  for (const [a, b] of insideSpans(plan.cols, (x) => [x, 0])) {
    const from = a === 0 ? -0.6 : a;
    walls.push(<IsoBox key={`wall-n-${a}`} x={from} y={-0.6} w={b - from} d={0.6} h={WALL_HEIGHT} c={PALETTE.wall} />);
  }
  for (const [a, b] of insideSpans(plan.rows, (y) => [0, y])) {
    walls.push(<IsoBox key={`wall-w-${a}`} x={-0.6} y={a} w={0.6} d={b - a} h={WALL_HEIGHT} c={PALETTE.wall} />);
  }
  // Windows on the west wall, where nothing tall stands against it and the name is not painted.
  for (let row = 0; row < plan.rows; row++) {
    if (!inside(0, row)) continue;
    const againstArea = groundFloor && [plan.kitchen, plan.pickup].some((a) => a && a.x === 0 && row >= a.y && row < a.y + a.h);
    const nameHere = name?.wall === "west" && row >= name.start && row < name.start + name.length;
    const doorHere = plan.door?.x === 0 && plan.door.y === row;
    if (againstArea || nameHere || doorHere || row % 2 === 1) continue;
    const a = row * CELL + 0.6;
    const b = (row + 1) * CELL - 0.6;
    walls.push(
      <g key={`win-${row}`}>
        <Poly points={[[0, a, 1.5], [0, b, 1.5], [0, b, 3.3], [0, a, 3.3]]} fill="#e4ebec" stroke="#d8cec3" strokeWidth={1.4} />
        <Line3 from={[0, (a + b) / 2, 1.5]} to={[0, (a + b) / 2, 3.3]} stroke="#d8cec3" strokeWidth={1.2} />
        <Poly points={[[0, a + 0.6, 1.7], [0, a + 1.4, 1.7], [0, a + 0.5, 3.1], [0, a + 0.1, 3.1]]} fill="#ffffff" opacity={0.6} />
      </g>,
    );
  }
  if (name && name.length > 0) {
    const text = ellipsize(restaurantName, 28);
    const span = name.length * CELL - 1.6;
    const fontSize = Math.max(7, Math.min(17, (span * 14) / (Array.from(text).length * 0.55)));
    const common = { fontFamily: "Georgia,'Times New Roman',serif", fontStyle: "italic", fontSize: r1(fontSize), fontWeight: 700, fill: "#c2410c" } as const;
    walls.push(
      name.wall === "north" ? (
        <IsoText key="name" x={name.start * CELL + 0.8} y={0} z={2.35} plane="wallY" {...common}>
          {text}
        </IsoText>
      ) : (
        <IsoText key="name" x={0} y={(name.start + name.length) * CELL - 0.8} z={2.35} plane="wallX" {...common}>
          {text}
        </IsoText>
      ),
    );
  }

  // ── Objects, painted back to front ──
  type Item = { key: string; rect: GridRect; node: ReactNode };
  const items: Item[] = [];
  for (const table of layout.tables) {
    const state = tableStates.get(table.id);
    const base = state?.base ?? "free";
    const colors = TABLE_COLORS[base];
    const [tx, ty] = project(...tableCenter(table.rect));
    const vertical = table.rect.h > table.rect.w;
    const indicator = state?.indicator ?? "free";
    items.push({
      key: `t-${table.id}`,
      rect: table.rect,
      node: (
        <g
          {...hit({ kind: "table", id: table.id }, `${table.label}: ${TABLE_STATE_LABELS[indicator]}`)}
          data-testid="live-table"
          data-state={indicator}
          data-label={table.label}
          data-orientation={vertical ? "vertical" : "horizontal"}
          transform={`translate(${r1(tx)},${r1(ty)}) scale(${TABLE_SCALE})`}
        >
          <TableArt
            shape={table.layout.shape}
            seats={table.layout.seats}
            top={colors.top}
            side={colors.side}
            food={base === "kitchen" ? "water" : base === "eating" ? "plates" : "none"}
            vertical={vertical}
            chairs={table.chairs}
          />
        </g>
      ),
    });
  }
  if (groundFloor) {
    const [kx, ky] = project(kitchenPlace.x, kitchenPlace.y);
    items.push({
      key: "kitchen",
      rect: plan.kitchen,
      node: (
        <g {...hit({ kind: "kitchen" }, `Cocina, ${kitchenCount} ${kitchenCount === 1 ? "comanda" : "comandas"} en curso`)} transform={`translate(${r1(kx)},${r1(ky)}) scale(${r1(kitchenPlace.scale * 100) / 100})`}>
          <KitchenArt />
        </g>
      ),
    });
  }
  if (plan.pickup && pickupPlace) {
    const [px, py] = project(pickupPlace.x, pickupPlace.y);
    items.push({
      key: "pickup",
      rect: plan.pickup,
      node: (
        <g
          {...hit({ kind: "pickup" }, `Mesón de retiro, ${readyPickups.length} ${readyPickups.length === 1 ? "pedido listo" : "pedidos listos"}`)}
          data-testid="live-pickup"
          transform={`translate(${r1(px)},${r1(py)}) scale(${r1(pickupPlace.scale * 100) / 100})`}
        >
          <PickupArt bags={Math.min(readyPickups.length, BAG_X.length)} />
        </g>
      ),
    });
  }
  for (const cell of corners) {
    const sx = cell.x === 0 ? 1.2 : (cell.x + 1) * CELL - 1.2;
    const sy = cell.y === 0 ? 1.2 : (cell.y + 1) * CELL - 1.2;
    items.push({ key: `plant-${cell.x}-${cell.y}`, rect: { ...cell, w: 1, h: 1 }, node: <Plant x={sx} y={sy} /> });
  }
  if (plan.door && !front) {
    items.push({
      key: "motos",
      rect: { ...plan.door, w: 1, h: 1 },
      node: (
        <g>
          {motos.map((order, i) => (
            <g key={order.id} {...hit({ kind: "order", id: order.id }, `Reparto #${order.ticketNumber}, ${order.rider?.name ?? "sin repartidor"}`)} data-testid="live-rider">
              <g className="lf-bob">
                <MotoArt toWorld={frames[i]!} speedLines={false} />
              </g>
            </g>
          ))}
        </g>
      ),
    });
  }
  for (const run of wallRuns(terrain, plan.cols, plan.rows, groundFloor ? plan.door : null)) {
    items.push({ key: `wall-${run.x}-${run.y}`, rect: { x: run.x, y: run.y, w: run.w, h: 1 }, node: <WallBlock run={run} /> });
  }
  for (const edge of voidEdges(terrain, plan.cols, plan.rows)) {
    items.push({ key: `curb-${edge.side}-${edge.x}-${edge.y}`, rect: voidEdgeRect(edge), node: <VoidCurb edge={edge} /> });
  }
  for (const item of level.decor) {
    items.push({ key: `decor-${item.x}-${item.y}`, rect: { x: item.x, y: item.y, w: 1, h: 1 }, node: <DecorArt kind={item.kind} x={item.x} y={item.y} /> });
  }
  const objects = paintOrder(items, (item) => item.rect);

  // ── Back door: painted on the wall ──
  let backDoor: ReactNode = null;
  if (plan.door && !front) {
    const west = side === "west";
    const s0 = (west ? plan.door.y : plan.door.x) * CELL;
    const s1 = s0 + CELL;
    const at = (s: number, z: number): [number, number, number] => (west ? [0, s, z] : [s, 0, z]);
    backDoor = (
      <g {...hit({ kind: "door" }, `Puerta de delivery, ${riders.length} en reparto`)} data-testid="live-door">
        <Poly points={[at(s0 + 0.4, 0), at(s1 - 0.4, 0), at(s1 - 0.4, 3.2), at(s0 + 0.4, 3.2)]} fill="#c2410c" />
        <Poly points={[at(s0 + 0.7, 0), at(s1 - 0.7, 0), at(s1 - 0.7, 2.9), at(s0 + 0.7, 2.9)]} fill="#3a3633" />
        {west ? (
          <IsoText x={0} y={s1 - 0.6} z={3.35} plane="wallX" fontSize={6.5} fontWeight={800} letterSpacing={1.2} fill="#c2410c">
            DELIVERY
          </IsoText>
        ) : (
          <IsoText x={s0 + 0.6} y={0} z={3.35} plane="wallY" fontSize={6.5} fontWeight={800} letterSpacing={1.2} fill="#c2410c">
            DELIVERY
          </IsoText>
        )}
      </g>
    );
  }

  // ── Front: low walls, the delivery door and the motorbikes on the street ──
  const frontLayer: ReactNode[] = [];
  {
    const gapEast = plan.door && side === "east" ? [plan.door.y * CELL, (plan.door.y + 1) * CELL] : null;
    const gapSouth = plan.door && side === "south" ? [plan.door.x * CELL, (plan.door.x + 1) * CELL] : null;
    // Spans of the front edges inside the building, cut at `length` and around the door.
    const segments = (spans: [number, number][], length: number, gap: number[] | null): [number, number][] =>
      spans
        .map(([a, b]): [number, number] => [a, Math.min(b, length)])
        .flatMap(([a, b]): [number, number][] => (gap ? [[a, Math.min(b, gap[0]!)], [Math.max(a, gap[1]!), b]] : [[a, b]]))
        .filter(([a, b]) => b - a > 0.05);
    const south = insideSpans(plan.cols, (x) => [x, plan.rows - 1]);
    const east = insideSpans(plan.rows, (y) => [plan.cols - 1, y]);
    for (const [a, b] of segments(south, W - 0.4, gapSouth)) frontLayer.push(<IsoBox key={`ws-${a}`} x={a} y={H - 0.4} w={b - a} d={0.4} h={0.9} c={PALETTE.wall} />);
    for (const [a, b] of segments(east, H, gapEast)) frontLayer.push(<IsoBox key={`we-${a}`} x={W - 0.4} y={a} w={0.4} d={b - a} h={0.9} c={PALETTE.wall} />);
    if (plan.door && front) {
      const east = side === "east";
      const s0 = (east ? plan.door.y : plan.door.x) * CELL;
      const s1 = s0 + CELL;
      frontLayer.push(
        <g key="door" {...hit({ kind: "door" }, `Puerta de delivery, ${riders.length} en reparto`)} data-testid="live-door">
          {east ? (
            <>
              <IsoBox x={W} y={s0 + 0.4} z={-1} w={1.5} d={CELL - 0.8} h={0.5} c={tone("#e2dad1")} />
              <IsoBox x={W - 0.5} y={s0} w={0.5} d={0.55} h={3.4} c={PALETTE.wall} />
              <IsoBox x={W - 0.5} y={s1 - 0.55} w={0.5} d={0.55} h={3.4} c={PALETTE.wall} />
              <IsoBox x={W - 0.5} y={s0} z={3} w={0.5} d={CELL} h={0.6} c={PALETTE.brand} />
              <IsoText x={W} y={s1 - 0.45} z={3.12} plane="wallX" fontSize={6.5} fontWeight={800} letterSpacing={1.2} fill="#ffffff">
                DELIVERY
              </IsoText>
            </>
          ) : (
            <>
              <IsoBox x={s0 + 0.4} y={H} z={-1} w={CELL - 0.8} d={1.5} h={0.5} c={tone("#e2dad1")} />
              <IsoBox x={s0} y={H - 0.5} w={0.55} d={0.5} h={3.4} c={PALETTE.wall} />
              <IsoBox x={s1 - 0.55} y={H - 0.5} w={0.55} d={0.5} h={3.4} c={PALETTE.wall} />
              <IsoBox x={s0} y={H - 0.5} z={3} w={CELL} d={0.5} h={0.6} c={PALETTE.brand} />
              <IsoText x={s0 + 0.45} y={H} z={3.12} plane="wallY" fontSize={6.5} fontWeight={800} letterSpacing={1.2} fill="#ffffff">
                DELIVERY
              </IsoText>
            </>
          )}
        </g>,
      );
      motos.forEach((order, i) => {
        frontLayer.push(
          <g key={`moto-${order.id}`} {...hit({ kind: "order", id: order.id }, `Reparto #${order.ticketNumber}, ${order.rider?.name ?? "sin repartidor"}`)} data-testid="live-rider">
            <g className="lf-bob">
              <MotoArt toWorld={frames[i]!} speedLines />
            </g>
          </g>,
        );
      });
    }
  }

  // ── Overlay: pins, tickets, labels ──
  const overlay: ReactNode[] = [];
  for (const table of layout.tables) {
    const state = tableStates.get(table.id);
    const indicator = state?.indicator ?? "free";
    const [X, Y] = project(...tableCenter(table.rect), TABLE_TOP_Z * TABLE_SCALE);
    const text = shortLabel(table.label);
    const target = hit({ kind: "table", id: table.id }, "", false);
    if (indicator === "waiter" || indicator === "bill") {
      const color = ALERT_COLORS[indicator];
      overlay.push(
        <g key={`pin-${table.id}`} {...target} transform={`translate(${r1(X)},${r1(Y)}) scale(${os})`} data-testid="live-table-alert" data-alert={indicator}>
          <ellipse cx={0} cy={0} rx={7} ry={3} fill="#1c1917" opacity={0.18} />
          <circle className="lf-pulse" cx={0} cy={-31} r={13} fill="none" stroke={color} strokeWidth={2.5} />
          <path transform="translate(0,-4)" d="M0 0 C-3 -6 -13 -13 -13 -27 A13 13 0 1 1 13 -27 C13 -13 3 -6 0 0 Z" fill={color} filter={url(ids.soft2)} />
          <path
            transform="translate(-6,-37.5) scale(.5)"
            d={indicator === "waiter" ? "M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Zm-2.5 16a2.5 2.5 0 0 0 5 0" : "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6"}
            fill="none"
            stroke="#ffffff"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={11} cy={-41} r={7.5 + Math.max(0, text.length - 2) * 2} fill="#ffffff" stroke={color} strokeWidth={1.5} />
          <text x={11} y={-37.6} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#1c1917">
            {text}
          </text>
        </g>,
      );
    } else {
      const badge = TABLE_COLORS[state?.base ?? "free"].badge;
      const chip = state?.session ? payingChip(state.session) : null;
      const chipWidth = chip ? 10 + Array.from(chip).length * 5.4 : 0;
      overlay.push(
        <g key={`pin-${table.id}`} {...target} transform={`translate(${r1(X)},${r1(Y)}) scale(${os})`}>
          <line x1={0} y1={-11} x2={0} y2={-2} stroke={badge} strokeWidth={1.4} />
          <circle cx={0} cy={-20} r={10 + Math.max(0, text.length - 2) * 2.5} fill="#ffffff" stroke={badge} strokeWidth={2} filter={url(ids.soft2)} />
          <text x={0} y={-16.2} textAnchor="middle" fontSize={11} fontWeight={800} fill="#1c1917">
            {text}
          </text>
          {chip ? (
            <>
              <rect x={13} y={-28.5} width={r1(chipWidth)} height={17} rx={8.5} fill={ALERT_COLORS.paying} />
              <text x={r1(13 + chipWidth / 2)} y={-16.7} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#ffffff">
                {chip}
              </text>
            </>
          ) : null}
        </g>,
      );
    }
  }

  // Tickets floating over the kitchen: Listo (by the pass), Pendiente, En preparación (by the oven).
  const shownGroups = groundFloor ? (["ready", "pending", "preparing"] as const).flatMap((key) => groups.filter((g) => g.key === key && g.tickets.length > 0)) : [];
  const [ax, ay] = frame.ticketsAnchor;
  if (groundFloor && shownGroups.length === 0) {
    overlay.push(
      <g key="no-tickets" {...hit({ kind: "kitchen" }, "", false)} transform={`translate(${r1(ax)},${r1(ay)}) scale(${os})`}>
        <rect x={-74} y={-22} width={148} height={22} rx={11} fill="#ffffff" fillOpacity={0.94} stroke="#e7e5e4" filter={url(ids.soft)} />
        <text x={0} y={-7.5} textAnchor="middle" fontSize={10} fontWeight={650} fill="#57534e">
          Sin comandas en curso
        </text>
      </g>,
    );
  }
  const step = (TICKET_GROUP.width + TICKET_GROUP.gap) * os;
  const startX = ax - ((shownGroups.length * TICKET_GROUP.width + (shownGroups.length - 1) * TICKET_GROUP.gap) * os) / 2;
  shownGroups.forEach((group, gi) => {
    const w = TICKET_GROUP.width;
    const h = TICKET_GROUP.header + group.shown.length * TICKET_GROUP.row + (group.hidden > 0 ? TICKET_GROUP.more : 0);
    const gx = startX + gi * step;
    const gy = ay - h * os;
    const anchor = artPoint(kitchenPlace, ...(KITCHEN_ANCHORS[group.key] as [number, number, number]));
    overlay.push(
      <g key={`grp-${group.key}`} data-testid="live-ticket-group" data-group={group.key}>
        <line x1={r1(anchor[0])} y1={r1(anchor[1])} x2={r1(gx + (w / 2) * os)} y2={r1(ay)} stroke={group.color} strokeWidth={1.3 * os} strokeDasharray={`${2 * os} ${3 * os}`} pointerEvents="none" />
        <circle cx={r1(anchor[0])} cy={r1(anchor[1])} r={3 * os} fill={group.color} pointerEvents="none" />
        <g transform={`translate(${r1(gx)},${r1(gy)}) scale(${os})`}>
          <g {...hit({ kind: "kitchen" }, "", false)}>
            <rect width={w} height={h} rx={11} fill="#ffffff" fillOpacity={0.94} stroke="#e7e5e4" filter={url(ids.soft)} />
            <circle cx={12} cy={13} r={3.5} fill={group.color} />
            <text x={20} y={16.5} fontSize={10} fontWeight={750} fill="#1c1917">
              {group.label}
            </text>
            <text x={w - 10} y={16.5} textAnchor="end" fontSize={10} fontWeight={700} fill="#57534e">
              {group.tickets.length}
            </text>
          </g>
          {group.shown.map((ticket, i) => {
            const ty = TICKET_GROUP.header + i * TICKET_GROUP.row;
            const clock = ticket.late ? "#b45309" : "#78716c";
            const order = ticket.order;
            return (
              <g
                key={order.id}
                {...hit({ kind: "order", id: order.id }, `Pedido #${order.ticketNumber}, ${timerLabel(ticket.minutes)}`)}
                data-testid="live-ticket"
                data-status={order.status}
                data-late={ticket.late ? "true" : "false"}
              >
                <rect x={6} y={ty} width={w - 12} height={33} rx={7} fill="#fafaf9" stroke="#efedeb" />
                <rect x={6} y={ty} width={3.5} height={33} rx={1.75} fill={group.color} />
                <text x={15} y={ty + 13.5} fontSize={9.5} fontWeight={750} fill="#1c1917">
                  #{order.ticketNumber}{" "}
                  <tspan fontWeight={600} fill="#57534e">
                    {ellipsize(order.channel === "dine_in" ? (order.tableLabel ?? "Mesa") : order.channel === "pickup" ? "Retiro" : "Delivery", 12)}
                  </tspan>
                </text>
                <g transform={`translate(15,${ty + 20})`}>
                  <circle cx={4} cy={4} r={3.6} fill="none" stroke={clock} strokeWidth={1.2} />
                  <path d="M4 2.2V4l1.3.9" fill="none" stroke={clock} strokeWidth={1.1} strokeLinecap="round" />
                </g>
                <text x={25} y={ty + 27.5} fontSize={9} fill={ticket.late ? "#b45309" : "#57534e"} fontWeight={ticket.late ? 700 : 500}>
                  {timerLabel(ticket.minutes)} · {ellipsize(order.customerName.trim() || `${order.items.reduce((s, it) => s + it.quantity, 0)} ítems`, 9)}
                </text>
              </g>
            );
          })}
          {group.hidden > 0 ? (
            <text x={w / 2} y={h - 5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#57534e" {...hit({ kind: "kitchen" }, "", false)}>
              +{group.hidden} más
            </text>
          ) : null}
        </g>
      </g>,
    );
  });

  // Labels of the bags on the pickup counter.
  if (pickupPlace) {
    readyPickups.slice(0, BAG_X.length).forEach((order, i) => {
      const [X, Y] = artPoint(pickupPlace, BAG_X[i]! + 0.55, 3.2, 3);
      const w = 74;
      const tx = i === 0 ? -w - 4 : i === 1 ? -w / 2 : 10;
      const ty = i === 1 ? -62 : i === 0 ? -39 : -35;
      overlay.push(
        <g key={`bag-${order.id}`} {...hit({ kind: "order", id: order.id }, "", false)} transform={`translate(${r1(X)},${r1(Y)}) scale(${os})`} data-testid="live-bag">
          <line x1={0} y1={-1} x2={i === 0 ? tx + w : i === 1 ? 0 : tx} y2={ty + 9} stroke="#a8a29e" strokeWidth={1.1} />
          <rect x={tx} y={ty} width={w} height={18} rx={9} fill="#ffffff" stroke="#e7e5e4" filter={url(ids.soft2)} />
          <text x={tx + w / 2} y={ty + 12.4} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#9a3412">
            #{order.ticketNumber}{" "}
            <tspan fontWeight={600} fill="#1c1917">
              {ellipsize(order.customerName.split(" ")[0] ?? "", 9)}
            </tspan>
          </text>
        </g>,
      );
    });
    if (readyPickups.length > BAG_X.length) {
      const [X, Y] = artPoint(pickupPlace, 12.5, 3, 2.6);
      overlay.push(
        <g key="bags-more" {...hit({ kind: "pickup" }, "", false)} transform={`translate(${r1(X)},${r1(Y)}) scale(${os})`}>
          <rect x={4} y={-30} width={40} height={18} rx={9} fill="#9a3412" />
          <text x={24} y={-17.6} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#ffffff">
            +{readyPickups.length - BAG_X.length}
          </text>
        </g>,
      );
    }
  }

  // Name tags over the motorbikes.
  motos.forEach((order, i) => {
    const [X, Y] = project(...frames[i]!(3.4, 0, 1.9));
    const tag = riderTag(order);
    const w = 14 + Array.from(tag).length * 4.9;
    overlay.push(
      <g key={`tag-${order.id}`} {...hit({ kind: "order", id: order.id }, "", false)} transform={`translate(${r1(X)},${r1(Y)}) scale(${os})`}>
        <rect x={-w / 2} y={-34} width={r1(w)} height={15} rx={7.5} fill="#ffffff" stroke="#bfdbfe" filter={url(ids.soft2)} />
        <text x={0} y={-23.4} textAnchor="middle" fontSize={8.5} fontWeight={750} fill="#1d4ed8">
          {tag}
        </text>
      </g>,
    );
  });
  if (riders.length > MAX_MOTOS && frames.length > 0) {
    const [X, Y] = project(...frames[frames.length - 1]!(1, 1.6, 0));
    overlay.push(
      <g key="motos-more" {...hit({ kind: "door" }, "", false)} transform={`translate(${r1(X)},${r1(Y)}) scale(${os})`}>
        <rect x={-18} y={-9} width={36} height={18} rx={9} fill="#1d4ed8" />
        <text x={0} y={3.6} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#ffffff">
          +{riders.length - MAX_MOTOS}
        </text>
      </g>,
    );
  }

  const { viewBox } = frame;
  const road = plan.door && front ? roadGradient(plan, side === "east") : null;
  return (
    <svg
      className="lf-scene block h-full w-full select-none"
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={label}
      data-testid="live-scene"
    >
      <style>{SCENE_CSS}</style>
      <defs>
        <filter id={ids.blur} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={9} />
        </filter>
        <filter id={ids.soft} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx={0} dy={6} stdDeviation={7} floodColor="#1c1917" floodOpacity={0.13} />
        </filter>
        <filter id={ids.soft2} x="-40%" y="-40%" width="180%" height="200%">
          <feDropShadow dx={0} dy={2} stdDeviation={2} floodColor="#1c1917" floodOpacity={0.18} />
        </filter>
        <linearGradient id={ids.cylShade} x1={0} x2={1} y1={0} y2={0}>
          <stop offset={0} stopColor="#ffffff" stopOpacity={0.22} />
          <stop offset={0.45} stopColor="#ffffff" stopOpacity={0} />
          <stop offset={1} stopColor="#1c1917" stopOpacity={0.14} />
        </linearGradient>
        <radialGradient id={ids.dome} cx={0.38} cy={0.3} r={0.8}>
          <stop offset={0} stopColor="#f3d6c0" />
          <stop offset={0.6} stopColor="#dba07c" />
          <stop offset={1} stopColor="#bf7c58" />
        </radialGradient>
        <radialGradient id={ids.glow}>
          <stop offset={0} stopColor="#fde68a" stopOpacity={0.75} />
          <stop offset={0.5} stopColor="#fde68a" stopOpacity={0.3} />
          <stop offset={1} stopColor="#fde68a" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={ids.fire}>
          <stop offset={0} stopColor="#fde68a" />
          <stop offset={0.45} stopColor="#fb923c" />
          <stop offset={1} stopColor="#ea580c" stopOpacity={0} />
        </radialGradient>
        {road ? (
          <>
            <linearGradient id={ids.roadGradient} gradientUnits="userSpaceOnUse" x1={road.x1} y1={road.y1} x2={road.x2} y2={road.y2}>
              <stop offset={0} stopColor="#fff" stopOpacity={0} />
              <stop offset={0.3} stopColor="#fff" />
              <stop offset={0.75} stopColor="#fff" />
              <stop offset={1} stopColor="#fff" stopOpacity={0} />
            </linearGradient>
            <mask id={ids.roadFade} maskUnits="userSpaceOnUse" x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height}>
              <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill={url(ids.roadGradient)} />
            </mask>
          </>
        ) : null}
      </defs>
      <g>{ground}</g>
      <g>{floorfx}</g>
      <g pointerEvents="none">{walls}</g>
      {backDoor}
      <g>
        {objects.map((item) => (
          <g key={item.key}>{item.node}</g>
        ))}
      </g>
      <g>{frontLayer}</g>
      <g>{overlay}</g>
    </svg>
  );
});

/** Gradient line along the street (both ends fade). */
function roadGradient(plan: LiveLayout["plan"], east: boolean) {
  const door = plan.door!;
  const c = east ? (door.y + 0.5) * CELL : (door.x + 0.5) * CELL;
  const a = east ? project(plan.cols * CELL + 4, c - 11, -1) : project(c - 11, plan.rows * CELL + 4, -1);
  const b = east ? project(plan.cols * CELL + 4, c + 9, -1) : project(c + 9, plan.rows * CELL + 4, -1);
  return { x1: r1(a[0]), y1: r1(a[1]), x2: r1(b[0]), y2: r1(b[1]) };
}

/** Dashed ring on the floor under the selected thing. */
function ringShape(ring: LiveTarget | null, layout: LiveLayout, motos: readonly OrderView[], frames: readonly MotoFrame[]): string | null {
  if (!ring) return null;
  const { plan } = layout;
  const rectPath = (r: GridRect) => floorRectPath(r.x * CELL + 0.2, r.y * CELL + 0.2, r.w * CELL - 0.4, r.h * CELL - 0.4);
  switch (ring.kind) {
    case "kitchen":
      return layout.ground ? rectPath(plan.kitchen) : null;
    case "pickup":
      return plan.pickup ? rectPath(plan.pickup) : null;
    case "door":
      return plan.door ? floorEllipse((plan.door.x + 0.5) * CELL, (plan.door.y + 0.5) * CELL, 2.4, 2.4).d : null;
    case "table": {
      const table = layout.tables.find((t) => t.id === ring.id);
      if (!table) return null;
      return floorEllipse(...tableCenter(table.rect), (table.rect.w * CELL) / 2 + 0.2, (table.rect.h * CELL) / 2 + 0.2).d;
    }
    case "order": {
      const index = motos.findIndex((o) => o.id === ring.id);
      if (index === -1) return null;
      const [x, y, z] = frames[index]!(3.2, 0, -1);
      return floorEllipse(x, y, 2.3, 2.3, z).d;
    }
  }
}

/** Keeps the tooltip (up to 240 px wide, centered on the pointer) inside the scene. */
function clampTip(x: number, width: number): number {
  return width > 240 ? Math.max(120, Math.min(width - 120, x)) : x;
}

export interface SceneTooltip {
  title: string;
  text: string;
}

/**
 * The interactive isometric scene: hover highlights and shows a tooltip, click/Enter selects. Event
 * delegation through `data-id` (see `targetKey`), so the memoized drawing never re-renders on hover.
 * `camera` (quarter turns, already applied to `data.layout`) and the floor drawn (`data.layout.floor`) only drive
 * the short fade when they change. `overlay` floats over the drawing's top-left corner (the floor selector).
 */
export function LiveScene({
  data,
  label,
  onSelect,
  describe,
  camera = 0,
  overlay,
  className,
}: {
  data: SceneData;
  label: string;
  onSelect(target: LiveTarget): void;
  describe(target: LiveTarget): SceneTooltip | null;
  camera?: number;
  overlay?: ReactNode;
  className?: string;
}) {
  const view = `${camera}:${data.layout.floor}`;
  const reactId = useId();
  const ids = useMemo(() => sceneIds(`lf${reactId}`), [reactId]);
  const scope = ids.blur;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ key: string; x: number; y: number } | null>(null);
  // The drawing fades in after the camera turns or the floor changes (not on the first paint); the tooltip would
  // point at the old spot.
  const [shownView, setShownView] = useState(view);
  const [fade, setFade] = useState(false);
  if (shownView !== view) {
    setShownView(view);
    setFade(true);
    setHover(null);
    setTip(null);
  }
  // Turning redraws the scene: the element that had the keyboard focus (a table, the kitchen) gets it back.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    const key = focused.current;
    if (!key || (document.activeElement && document.activeElement !== document.body)) return;
    wrapRef.current?.querySelector<SVGElement>(`[data-id="${key}"][tabindex]`)?.focus();
  }, [view]);

  const keyOf = (element: EventTarget | null) => (element instanceof Element ? (element.closest("[data-id]")?.getAttribute("data-id") ?? null) : null);

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const key = keyOf(event.target);
    if (key !== hover) setHover(key);
    const box = wrapRef.current?.getBoundingClientRect();
    if (key && box && event.pointerType === "mouse") setTip({ key, x: clampTip(event.clientX - box.left, box.width), y: event.clientY - box.top });
    else if (tip) setTip(null);
  }

  function onFocus(event: FocusEvent<HTMLDivElement>) {
    const key = keyOf(event.target);
    focused.current = key;
    setHover(key);
    const box = wrapRef.current?.getBoundingClientRect();
    if (!key || !box || !(event.target instanceof Element)) return;
    const rect = event.target.getBoundingClientRect();
    setTip({ key, x: clampTip(rect.left + rect.width / 2 - box.left, box.width), y: rect.top - box.top });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = parseTarget(keyOf(event.target));
    if (!target) return;
    event.preventDefault();
    onSelect(target);
  }

  const tipTarget = tip ? parseTarget(tip.key) : null;
  const tipText = tipTarget ? describe(tipTarget) : null;
  const hoverCss = hover
    ? `[data-scene="${scope}"] [data-id="${hover}"]:not(.lf-zone){filter:drop-shadow(0 0 3px rgba(194,65,12,.55))}[data-scene="${scope}"] .lf-zone[data-id="${hover}"]{fill:#fde7d8}`
    : "";

  return (
    <div
      ref={wrapRef}
      data-scene={scope}
      className={cn("relative min-w-0", className)}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        setHover(null);
        setTip(null);
      }}
      onClick={(event) => {
        const target = parseTarget(keyOf(event.target));
        if (target) onSelect(target);
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={(event) => {
        // Focus moved somewhere else; null = the focused element went away (the drawing was redrawn).
        if (event.relatedTarget) focused.current = null;
        setHover(null);
        setTip(null);
      }}
    >
      {/* Only [\w:-] reach the selector (targetKey/parseTarget), so the rule cannot be broken out of. */}
      {hover && parseTarget(hover) ? <style>{hoverCss}</style> : null}
      <SceneIdsContext.Provider value={ids}>
        <div key={view} className={cn("h-full w-full", fade && "animate-in duration-300 fade-in-0 motion-reduce:animate-none")} data-testid="live-camera" data-angle={camera * 90}>
          <SceneSvg data={data} ids={ids} label={label} />
        </div>
      </SceneIdsContext.Provider>
      {/* On desktop the indicator cards overlap the top edge of the scene: start below them. */}
      {overlay ? <div className="absolute top-2 left-2 z-[2] max-w-[calc(100%_-_1rem)] xl:top-12 xl:left-4">{overlay}</div> : null}
      {tip && tipText ? (
        <div
          className="pointer-events-none absolute z-10 max-w-60 -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-lg bg-foreground px-2.5 py-1.5 text-xs leading-snug text-background shadow-lg"
          style={{ left: tip.x, top: tip.y }}
          role="presentation"
        >
          <strong className="block text-[12.5px]">{tipText.title}</strong>
          <span className="opacity-85">{tipText.text}</span>
        </div>
      ) : null}
    </div>
  );
}
