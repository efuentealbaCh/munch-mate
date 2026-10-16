import type { DecorKind, FloorLevel } from "@app/types";
import type { ReactNode } from "react";
import { DECOR_LABELS, MATERIAL_LOOKS } from "@/lib/floor-materials";
import { buildingRuns, CELL, type CellRun, project, r1, shade, type TerrainRun, tone, type Tone, type VoidEdge, WALL_BLOCK_HEIGHT } from "@/lib/live-floor";
import { Cyl, Disc, IsoBox, PALETTE, Plant, Poly, url, useSceneIds } from "./iso-shapes";

/**
 * What the owner paints and places on each floor, drawn isometrically: the floor's materials (one polygon per run
 * of equal cells plus a light pattern path), raised walls, the curbs around cells outside the building and the
 * decorations. Coordinates are world units (see `project` in lib/live-floor); colors come from MATERIAL_LOOKS,
 * the same palette as the editor.
 */

/** Floor color and plank lines of an unpainted plan (the same as before terrain existed). */
export const PLAIN_FLOOR = { dining: "#f2e7d9", bare: "#f3efe9", plank: "#e8d8c4" } as const;

/** "M x,y L x,y" between two world points (pieces of one pattern path). */
function seg(from: readonly [number, number, number?], to: readonly [number, number, number?]): string {
  const a = project(from[0], from[1], from[2] ?? 0);
  const b = project(to[0], to[1], to[2] ?? 0);
  return `M${r1(a[0])},${r1(a[1])}L${r1(b[0])},${r1(b[1])}`;
}

/** Lines along x at the given world y values, across the run. */
function rowLines(x0: number, x1: number, ys: readonly number[]): string {
  return ys.map((y) => seg([x0, y], [x1, y])).join("");
}

/** Lines along y between `y0` and `y1` at every multiple of `step` (plus `offset`) inside the run. */
function joints(x0: number, x1: number, y0: number, y1: number, step: number, offset = 0): string {
  let d = "";
  for (let x = Math.ceil((x0 - offset) / step) * step + offset; x < x1; x += step) if (x > x0) d += seg([x, y0], [x, y1]);
  return d;
}

/** Deterministic 0–1 value per cell and slot, so the grass tufts do not move between renders. */
function jitter(x: number, y: number, slot: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + slot * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

/** The light pattern of a run (planks, tile joints, grass tufts), as one path; "" when the material is plain. */
function runPattern(run: TerrainRun, dining: boolean): string {
  const x0 = run.x * CELL;
  const x1 = (run.x + run.w) * CELL;
  const y0 = run.y * CELL;
  const y1 = y0 + CELL;
  switch (run.material) {
    case "floor": {
      // The dining room's planks of an unpainted plan, every 1.75 units of the whole floor.
      if (!dining) return "";
      const ys: number[] = [];
      for (let py = Math.ceil(y0 / 1.75) * 1.75; py < y1; py += 1.75) if (py > 0) ys.push(py);
      return rowLines(x0, x1, ys);
    }
    case "wood": {
      let d = rowLines(x0, x1, [y0 + 1, y0 + 2, y0 + 3]);
      // Plank ends, staggered per band.
      for (let band = 0; band < 4; band++) d += joints(x0, x1, y0 + band, y0 + band + 1, 3, (band % 2) * 1.5 + (run.y % 2) * 0.75);
      return d;
    }
    case "tile":
      return rowLines(x0, x1, [y0 + 2]) + joints(x0, x1, y0, y1, 2);
    case "stone":
      return rowLines(x0, x1, [y0 + 2]) + joints(x0, x1, y0, y0 + 2, 2) + joints(x0, x1, y0 + 2, y1, 2, 1);
    case "carpet":
      return rowLines(x0, x1, [y0 + 0.7, y1 - 0.7]);
    case "grass": {
      let d = "";
      for (let x = run.x; x < run.x + run.w; x++) {
        for (let slot = 0; slot < 3; slot++) {
          const tx = x * CELL + 0.5 + jitter(x, run.y, slot) * 3;
          const ty = y0 + 0.5 + jitter(run.y, x, slot + 5) * 3;
          d += seg([tx, ty, 0], [tx - 0.15, ty, 0.45]) + seg([tx, ty, 0], [tx + 0.2, ty, 0.4]);
        }
      }
      return d;
    }
    default:
      return "";
  }
}

/**
 * The slab under a floor with cells outside the building: one block (and its soft shadow) per row run of building
 * cells, back to front, so the drop at the edge of an L-shaped place shows. Runs on the grid's back edges reach
 * under the back walls, like the slab of an unpainted plan.
 */
export function SlabRuns({ level, cols, rows }: { level: FloorLevel; cols: number; rows: number }) {
  const ids = useSceneIds();
  const runs = buildingRuns(level.terrain, cols, rows);
  const box = (run: CellRun) => {
    const x = run.x === 0 ? -0.6 : run.x * CELL;
    const y = run.y === 0 ? -0.6 : run.y * CELL;
    return { x, y, w: (run.x + run.w) * CELL - x, d: (run.y + 1) * CELL - y };
  };
  return (
    <>
      <g filter={url(ids.blur)} opacity={0.2}>
        {runs.map((run) => {
          const b = box(run);
          return <Poly key={`sh-${run.x}-${run.y}`} points={[[b.x, b.y, -1.4], [b.x + b.w + 1.5, b.y, -1.4], [b.x + b.w + 1.5, b.y + b.d + 1.5, -1.4], [b.x, b.y + b.d + 1.5, -1.4]]} fill="#6b4f3a" />;
        })}
      </g>
      {runs.map((run) => {
        const b = box(run);
        return <IsoBox key={`sl-${run.x}-${run.y}`} x={b.x} y={b.y} z={-1} w={b.w} d={b.d} h={1} c={PALETTE.slab} />;
      })}
    </>
  );
}

/** The painted floor: each run in its material's color with its pattern. Wall cells are left to their blocks. */
export function TerrainFloor({ runs, dining }: { runs: readonly TerrainRun[]; dining: boolean }) {
  const tops: ReactNode[] = [];
  const patterns: ReactNode[] = [];
  for (const run of runs) {
    if (run.material === "wall") continue;
    const x0 = run.x * CELL;
    const x1 = (run.x + run.w) * CELL;
    const y0 = run.y * CELL;
    const y1 = y0 + CELL;
    const look = MATERIAL_LOOKS[run.material];
    const plain = run.material === "floor";
    tops.push(
      <Poly
        key={`${run.x}-${run.y}`}
        points={[[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]]}
        fill={plain ? (dining ? PLAIN_FLOOR.dining : PLAIN_FLOOR.bare) : look.top}
        // Same-color neighbors would show hairline seams between their polygons (antialiasing).
        stroke={plain ? (dining ? PLAIN_FLOOR.dining : PLAIN_FLOOR.bare) : look.top}
        strokeWidth={0.6}
      />,
    );
    const d = runPattern(run, dining);
    if (d) {
      const grass = run.material === "grass";
      patterns.push(
        <path
          key={`p-${run.x}-${run.y}`}
          d={d}
          fill="none"
          stroke={plain ? PLAIN_FLOOR.plank : grass ? shade(look.accent, 0.12) : look.accent}
          strokeWidth={grass ? 1 : 0.8}
          strokeLinecap="round"
        />,
      );
    }
  }
  return (
    <g pointerEvents="none" data-testid="live-terrain">
      {tops}
      {patterns}
    </g>
  );
}

const WALL_TONE: Tone = { t: MATERIAL_LOOKS.wall.top, l: MATERIAL_LOOKS.wall.side, r: shade(MATERIAL_LOOKS.wall.side, 0.14) };

/** A run of wall cells: one low block (WALL_BLOCK_HEIGHT), so the tables behind it stay in sight. */
export function WallBlock({ run }: { run: CellRun }) {
  return (
    <IsoBox x={run.x * CELL} y={run.y * CELL} w={run.w * CELL} d={CELL} h={WALL_BLOCK_HEIGHT} c={WALL_TONE} pointerEvents="none" data-testid="live-wall">
      <title>{MATERIAL_LOOKS.wall.label}</title>
    </IsoBox>
  );
}

/** A low curb on the edge of the building facing cells outside it (like the front walls of the plan). */
export function VoidCurb({ edge }: { edge: VoidEdge }) {
  const t = 0.4;
  const along = edge.length * CELL;
  const box =
    edge.side === "north"
      ? { x: edge.x * CELL, y: edge.y * CELL, w: along, d: t }
      : edge.side === "south"
        ? { x: edge.x * CELL, y: (edge.y + 1) * CELL - t, w: along, d: t }
        : edge.side === "west"
          ? { x: edge.x * CELL, y: edge.y * CELL, w: t, d: along }
          : { x: (edge.x + 1) * CELL - t, y: edge.y * CELL, w: t, d: along };
  return <IsoBox {...box} h={0.9} c={PALETTE.wall} pointerEvents="none" />;
}

// ── Decorations ─────────────────────────────────────────────────────────────

const LEAVES = ["#5f8a63", "#6f9a72", "#82ab83"] as const;

function Tree({ x, y }: { x: number; y: number }) {
  const [px, py] = project(x, y, 3.4);
  return (
    <g>
      <Disc x={x} y={y} r={1.5} fill="#1c1917" opacity={0.12} />
      <Cyl x={x} y={y} r={0.22} h={2.4} top="#7a5c45" side="#8a6a4f" />
      <circle cx={r1(px - 9)} cy={r1(py + 5)} r={12} fill={LEAVES[0]} />
      <circle cx={r1(px + 9)} cy={r1(py + 3)} r={12.5} fill={LEAVES[1]} />
      <circle cx={r1(px)} cy={r1(py - 7)} r={13} fill={LEAVES[2]} />
      <circle cx={r1(px - 3)} cy={r1(py - 11)} r={5} fill="#ffffff" opacity={0.12} />
    </g>
  );
}

function Planter({ x, y }: { x: number; y: number }) {
  const bushes = [-1, 0, 1].map((i) => project(x + i * 1, y, 1.25));
  return (
    <g>
      <IsoBox x={x - 1.6} y={y - 0.65} w={3.2} d={1.3} h={0.9} c={tone("#c9a88a", 0.08, 0.17)} />
      <Poly points={[[x - 1.45, y - 0.5, 0.9], [x + 1.45, y - 0.5, 0.9], [x + 1.45, y + 0.5, 0.9], [x - 1.45, y + 0.5, 0.9]]} fill="#7a5c45" />
      {bushes.map(([bx, by], i) => (
        <circle key={i} cx={r1(bx)} cy={r1(by)} r={7.5} fill={LEAVES[i]} />
      ))}
    </g>
  );
}

function Flowers({ x, y }: { x: number; y: number }) {
  const [px, py] = project(x, y, 0.85);
  const blooms: [number, number, string][] = [
    [-5, -2, "#f472b6"],
    [4, -4, "#facc15"],
    [0, -7, "#ffffff"],
    [6, 1, "#f472b6"],
    [-3, 2, "#fb923c"],
  ];
  return (
    <g>
      <Cyl x={x} y={y} r={0.7} h={0.5} top="#7a5c45" side="#c97b5a" />
      <ellipse cx={r1(px)} cy={r1(py)} rx={11} ry={7} fill="#6f9a72" />
      {blooms.map(([dx, dy, color], i) => (
        <circle key={i} cx={r1(px + dx)} cy={r1(py + dy)} r={2.4} fill={color} stroke="#ffffff" strokeWidth={0.5} />
      ))}
    </g>
  );
}

function Lamp({ x, y }: { x: number; y: number }) {
  const ids = useSceneIds();
  const [bx, by] = project(x, y, 0.1);
  const [tx, ty] = project(x, y, 2.9);
  const [gx, gy] = project(x, y, 3.05);
  return (
    <g>
      <Disc className="lf-glow" x={x} y={y} r={2.2} fill={url(ids.glow)} />
      <Disc x={x} y={y} r={0.4} fill="#57534e" />
      <line x1={r1(bx)} y1={r1(by)} x2={r1(tx)} y2={r1(ty)} stroke="#57534e" strokeWidth={1.6} strokeLinecap="round" />
      <circle className="lf-glow" cx={r1(gx)} cy={r1(gy)} r={11} fill={url(ids.glow)} />
      <Cyl x={x} y={y} z={2.8} r={0.5} h={0.55} top="#fef3c7" side="#f5e6c8" />
    </g>
  );
}

function Umbrella({ x, y }: { x: number; y: number }) {
  const r = 1.75;
  const rim = Array.from({ length: 8 }, (_, i): [number, number, number] => {
    const angle = (i / 8) * Math.PI * 2;
    return [x + r * Math.cos(angle), y + r * Math.sin(angle), 3];
  });
  const [bx, by] = project(x, y, 0.2);
  const [tx, ty] = project(x, y, 3.8);
  return (
    <g>
      <Disc x={x} y={y} r={1.6} fill="#1c1917" opacity={0.1} />
      <Cyl x={x} y={y} r={0.35} h={0.2} top="#78716c" side="#57534e" />
      <line x1={r1(bx)} y1={r1(by)} x2={r1(tx)} y2={r1(ty)} stroke="#57534e" strokeWidth={1.3} />
      {/* A shallow cone seen from above: every panel faces the camera, so they need no sorting. */}
      {rim.map((point, i) => (
        <Poly key={i} points={[[x, y, 3.8], point, rim[(i + 1) % rim.length]!]} fill={i % 2 === 0 ? PALETTE.brand.t : "#fbf4ec"} stroke="#ffffff" strokeWidth={0.4} />
      ))}
    </g>
  );
}

function Bench({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {[-1.15, 1.0].map((lx) => (
        <IsoBox key={lx} x={x + lx} y={y - 0.35} w={0.15} d={0.7} h={0.7} c={PALETTE.ink} />
      ))}
      <IsoBox x={x - 1.3} y={y - 0.55} z={0.7} w={2.6} d={0.16} h={0.85} c={PALETTE.chair} />
      <IsoBox x={x - 1.3} y={y - 0.4} z={0.7} w={2.6} d={0.8} h={0.16} c={PALETTE.chair} />
    </g>
  );
}

/** One decoration standing on its cell, with its name as the native tooltip. */
export function DecorArt({ kind, x, y }: { kind: DecorKind; x: number; y: number }) {
  const cx = (x + 0.5) * CELL;
  const cy = (y + 0.5) * CELL;
  const art =
    kind === "plant" ? (
      <Plant x={cx} y={cy} />
    ) : kind === "tree" ? (
      <Tree x={cx} y={cy} />
    ) : kind === "planter" ? (
      <Planter x={cx} y={cy} />
    ) : kind === "flowers" ? (
      <Flowers x={cx} y={cy} />
    ) : kind === "lamp" ? (
      <Lamp x={cx} y={cy} />
    ) : kind === "umbrella" ? (
      <Umbrella x={cx} y={cy} />
    ) : (
      <Bench x={cx} y={cy} />
    );
  return (
    <g data-testid="live-decor" data-kind={kind}>
      <title>{DECOR_LABELS[kind]}</title>
      {art}
    </g>
  );
}
