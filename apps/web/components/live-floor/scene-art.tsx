import { ISO_UNIT, project, r1, shade, tone, type Vec3 } from "@/lib/live-floor";
import { Cyl, Disc, ellipseOf, IsoBox, Line3, PALETTE, Person, Poly, url, useSceneIds } from "./iso-shapes";

/**
 * The drawings of the live view, in their own local coordinates (world units), as in the approved mock-up.
 * The scene places each one with `translate(project(origin)) scale(k)`: a uniformly scaled isometric drawing
 * is still isometric, so the kitchen fits any rectangle of the plan without being redrawn.
 */

// ── Kitchen ─────────────────────────────────────────────────────────────────

/** Points of the kitchen drawing the floating tickets point at (local coordinates). */
export const KITCHEN_ANCHORS = {
  pending: [4.2, 1.3, 1.7] as Vec3,
  preparing: [13.1, 2.8, 3.4] as Vec3,
  ready: [0.6, 6, 1.7] as Vec3,
};

/**
 * Kitchen of the mock-up (KITCHEN_ART = 15.6 × 12): tiled back wall with a shelf, stove counter, pass counter
 * towards the dining room, fridge, wood-fired oven with its glow and smoke, prep island with pizzas and two
 * cooks. Painted back to front.
 */
export function KitchenArt() {
  const ids = useSceneIds();
  const tiles: number[] = [];
  for (let tx = 2.4; tx < 15.6; tx += 1.2) tiles.push(Math.round(tx * 10) / 10);

  // Oven: dome over a brick base, chimney with smoke, a glowing mouth.
  const e = ellipseOf(13.1, 2.8, 1.3, 1.75);
  const dh = 1.9 * ISO_UNIT;
  const chx = r1(e.X + 7);
  const chy = r1(e.Y - dh + 3);
  const mx = r1(e.X);
  const my = r1(e.Y + e.ry - 1.5);
  const [hx1, hy1] = project(10.8, 1.8, 2.2);
  const [hx2, hy2] = project(10.8, 1.8, 1.2);

  return (
    <g>
      {/* Back wall with tiles and a shelf of jars. */}
      <IsoBox x={1.2} y={0} w={14.4} d={0.3} h={3.6} c={PALETTE.wall} />
      <Poly points={[[1.2, 0.3, 0], [15.6, 0.3, 0], [15.6, 0.3, 2.5], [1.2, 0.3, 2.5]]} fill="#faf9f7" />
      {tiles.map((tx) => (
        <Line3 key={tx} from={[tx, 0.3, 0]} to={[tx, 0.3, 2.5]} stroke="#ebe7e2" strokeWidth={0.7} />
      ))}
      {[0.83, 1.66].map((tz) => (
        <Line3 key={tz} from={[1.2, 0.3, tz]} to={[15.6, 0.3, tz]} stroke="#ebe7e2" strokeWidth={0.7} />
      ))}
      <IsoBox x={2} y={0.3} z={2.85} w={6.8} d={0.6} h={0.14} c={PALETTE.steel} />
      {[2.6, 3.4, 4.2, 7, 7.9].map((jx, i) => (
        <Cyl key={jx} x={jx} y={0.6} z={2.99} r={0.2} h={0.45 + (i % 2) * 0.12} top={i < 3 ? "#f4d7c5" : "#dfe9d8"} side={i < 3 ? "#e2a882" : "#b7cfae"} />
      ))}

      {/* Stove counter. */}
      <IsoBox x={1.8} y={0.3} w={7.2} d={2} h={1.6} c={PALETTE.steel} />
      <Poly points={[[2.2, 0.6, 1.61], [6.2, 0.6, 1.61], [6.2, 2, 1.61], [2.2, 2, 1.61]]} fill="#3a3633" />
      {[3.2, 5.2].map((bx) => (
        <Disc key={bx} x={bx} y={1.3} z={1.62} r={0.42} fill="none" stroke="#78716c" strokeWidth={1.2} />
      ))}
      <Cyl x={5.2} y={1.3} z={1.62} r={0.45} h={0.55} top="#d6d3d1" side="#a8a29e" />
      <IsoBox x={7} y={0.7} z={1.6} w={1.5} d={1.1} h={0.12} c={tone("#ecdcc6")} />

      {/* Pass counter towards the dining room, with two plates waiting. */}
      <IsoBox x={0} y={1.8} w={1.2} d={9} h={1.6} c={PALETTE.steel} />
      <Disc x={0.6} y={4.3} z={1.6} r={0.42} fill="#ffffff" stroke="#e2ded9" strokeWidth={0.6} />
      <Disc x={0.6} y={4.3} z={1.6} r={0.32} fill="#f3c568" />
      <Disc x={0.6} y={7.5} z={1.6} r={0.42} fill="#ffffff" stroke="#e2ded9" strokeWidth={0.6} />
      <Disc x={0.6} y={7.5} z={1.6} r={0.3} fill="#e6efe0" />

      {/* Fridge. */}
      <IsoBox x={9.2} y={0.3} w={1.6} d={1.8} h={3.3} c={PALETTE.steel} />
      <line x1={r1(hx1)} y1={r1(hy1)} x2={r1(hx2)} y2={r1(hy2)} stroke="#a8a29e" strokeWidth={1.6} strokeLinecap="round" />

      <Person x={6.8} y={5.6} look={{ body: "#f5f5f4", top: "#ffffff", hat: true, skin: "#c98e6a" }} />

      {/* Prep island with dough, a pizza and sauce. */}
      <IsoBox x={3.6} y={6.7} w={7} d={2.6} h={1.55} c={PALETTE.steel} />
      <IsoBox x={3.6} y={6.7} z={1.55} w={7} d={2.6} h={0.12} c={tone("#ecd9c3")} />
      <Disc x={5} y={8} z={1.67} r={0.55} fill="#f6ead7" stroke="#e3cfb3" strokeWidth={0.7} />
      <Disc x={6.7} y={8} z={1.67} r={0.55} fill="#f6ead7" stroke="#e3cfb3" strokeWidth={0.7} />
      <Disc x={6.7} y={8} z={1.67} r={0.42} fill="#d9643a" />
      <Disc x={8.5} y={8} z={1.67} r={0.6} fill="#d98a3d" />
      <Disc x={8.5} y={8} z={1.67} r={0.5} fill="#f3c568" />
      <Disc x={8.35} y={7.85} z={1.67} r={0.08} fill="#c2410c" />
      <Disc x={8.65} y={8.15} z={1.67} r={0.08} fill="#c2410c" />
      <Disc x={8.4} y={8.25} z={1.67} r={0.07} fill="#5f8a63" />
      <Cyl x={9.9} y={7.5} z={1.67} r={0.3} h={0.35} top="#c2410c" side="#e7e5e4" />

      {/* Wood-fired oven. */}
      <IsoBox x={11} y={0.7} w={4.2} d={4.2} h={1.3} c={PALETTE.brick} />
      <rect x={chx} y={r1(chy - 20)} width={9} height={22} fill="#b4aaa1" />
      <rect x={r1(chx + 5)} y={r1(chy - 20)} width={4} height={22} fill="#9c938b" />
      <ellipse cx={r1(chx + 4.5)} cy={r1(chy - 20)} rx={4.5} ry={2.2} fill="#cfc7bf" />
      {["lf-s1", "lf-s2", "lf-s3"].map((delay) => (
        <circle key={delay} className={`lf-smoke ${delay}`} cx={r1(chx + 4.5)} cy={r1(chy - 26)} r={5} fill="#e7e5e4" />
      ))}
      <path
        d={`M${r1(e.X - e.rx)},${r1(e.Y)} A${r1(e.rx)},${r1(dh)} 0 0 1 ${r1(e.X + e.rx)},${r1(e.Y)} A${r1(e.rx)},${r1(e.ry)} 0 0 1 ${r1(e.X - e.rx)},${r1(e.Y)} Z`}
        fill={url(ids.dome)}
      />
      <ellipse className="lf-glow" cx={mx} cy={r1(my + 3)} rx={22} ry={9} fill={url(ids.fire)} opacity={0.8} />
      <path d={`M${r1(mx - 10.5)},${my} v-8 a10.5,10.5 0 0 1 21,0 v8 Z`} fill="#c98a64" />
      <path d={`M${r1(mx - 8)},${my} v-7 a8,8 0 0 1 16,0 v7 Z`} fill="#2f231c" />
      <ellipse className="lf-glow" cx={mx} cy={r1(my - 3)} rx={6.5} ry={4.5} fill={url(ids.fire)} />

      <Person x={12.5} y={6.7} look={{ body: "#f5f5f4", top: "#ffffff", hat: true }} />
    </g>
  );
}

// ── Pickup counter ──────────────────────────────────────────────────────────

/** Where the bags stand on the counter (local x); at most this many are drawn. */
export const BAG_X = [3.6, 6.6, 9.6] as const;

/** Pickup counter of the mock-up (PICKUP_ART = 15 × 9): one bag per ready order and a customer waiting. */
export function PickupArt({ bags }: { bags: number }) {
  return (
    <g>
      <IsoBox x={2.5} y={2.2} w={11} d={2} h={1.7} c={PALETTE.wood} />
      <Poly points={[[2.5, 4.2, 0.42], [13.5, 4.2, 0.42], [13.5, 4.2, 0.72], [2.5, 4.2, 0.72]]} fill="#c2410c" />
      <IsoBox x={12} y={2.7} z={1.7} w={0.95} d={0.65} h={0.65} c={PALETTE.ink} />
      {BAG_X.slice(0, bags).map((bx) => (
        <g key={bx}>
          <IsoBox x={bx} y={2.8} z={1.7} w={1.1} d={0.8} h={1.3} c={PALETTE.kraft} />
          <Line3 from={[bx + 0.2, 3.6, 2.75]} to={[bx + 0.9, 3.6, 2.75]} stroke="#a9825b" strokeWidth={1} />
          <Poly points={[[bx + 0.3, 3.6, 2], [bx + 0.8, 3.6, 2], [bx + 0.8, 3.6, 2.45], [bx + 0.3, 3.6, 2.45]]} fill="#c2410c" />
        </g>
      ))}
      {bags > 0 ? <Person x={7} y={7.2} look={{ body: "#7c8a72", top: "#93a089", hair: "#5b3a24" }} /> : null}
    </g>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────────

export type TableFood = "none" | "water" | "plates";

interface Chair {
  x: number;
  y: number;
  dir: "N" | "S" | "W" | "E";
}

/** Half the length of a long (6–8 seats) table top, local units. */
const LONG_HALF = 3.4;

/** Where the chairs of a table go, before turning it (back = drawn before the table, front = after). */
function chairsFor(seats: number, sides: "top-bottom" | "left-right"): { back: Chair[]; front: Chair[] } {
  if (seats >= 6) {
    const xs = seats === 8 ? [-2.4, 0, 2.4] : [-1.4, 1.4];
    return {
      back: [...xs.map((x) => ({ x, y: -2.1, dir: "N" as const })), { x: -(LONG_HALF + 0.8), y: 0, dir: "W" }],
      front: [...xs.map((x) => ({ x, y: 2.1, dir: "S" as const })), { x: LONG_HALF + 0.8, y: 0, dir: "E" }],
    };
  }
  // 4 seats: one chair on every side, whatever the rotation; 2 seats: on the sides the table faces.
  const topBottom = seats >= 4 || sides === "top-bottom";
  const leftRight = seats >= 4 || sides === "left-right";
  return {
    back: [...(topBottom ? [{ x: 0, y: -2.1, dir: "N" as const }] : []), ...(leftRight ? [{ x: -2.1, y: 0, dir: "W" as const }] : [])],
    front: [...(topBottom ? [{ x: 0, y: 2.1, dir: "S" as const }] : []), ...(leftRight ? [{ x: 2.1, y: 0, dir: "E" as const }] : [])],
  };
}

/** The same chair on a table turned to the vertical (x and y swapped: its back faces the other way). */
const SWAP_DIR = { N: "W", S: "E", W: "N", E: "S" } as const;

function ChairArt({ chair }: { chair: Chair }) {
  const { x, y, dir } = chair;
  const c = PALETTE.chair;
  return (
    <g>
      <IsoBox x={x - 0.45} y={y - 0.45} w={0.9} d={0.9} h={0.85} c={c} />
      {dir === "N" ? <IsoBox x={x - 0.45} y={y - 0.45} z={0.85} w={0.9} d={0.16} h={1} c={c} /> : null}
      {dir === "S" ? <IsoBox x={x - 0.45} y={y + 0.29} z={0.85} w={0.9} d={0.16} h={1} c={c} /> : null}
      {dir === "W" ? <IsoBox x={x - 0.45} y={y - 0.45} z={0.85} w={0.16} d={0.9} h={1} c={c} /> : null}
      {dir === "E" ? <IsoBox x={x + 0.29} y={y - 0.45} z={0.85} w={0.16} d={0.9} h={1} c={c} /> : null}
    </g>
  );
}

/** Height of the table top (local units): where pins and food sit. */
export const TABLE_TOP_Z = 1.5;

/**
 * A table with its chairs (local origin = its center): round or square, 2/4 seats on one cell, 6/8 seats as a
 * long table. The top takes the state color; what is on it hints the state (water while waiting, plates
 * when served). `vertical` lays a long table along y (its footprint is 1 × 2): the drawing is built with x and
 * y swapped rather than mirrored, so the lit faces of every box stay on the same side as the rest of the scene.
 * `chairs` puts the 2 chairs of a 2-seat table above and below or left and right.
 */
export function TableArt({
  shape,
  seats,
  top,
  side,
  food,
  vertical = false,
  chairs = "top-bottom",
}: {
  shape: "round" | "square";
  seats: number;
  top: string;
  side: string;
  food: TableFood;
  vertical?: boolean;
  chairs?: "top-bottom" | "left-right";
}) {
  const z = 1.25;
  const long = seats >= 6;
  const turn = long && vertical;
  const half = long ? LONG_HALF : 1.3;
  // Local (x, y) of the horizontal drawing → where it goes on this table.
  const at = (x: number, y: number): [number, number] => (turn ? [y, x] : [x, y]);
  const box = (x: number, y: number, w: number, d: number) => (turn ? { x: y, y: x, w: d, d: w } : { x, y, w, d });
  const turnChair = (chair: Chair): Chair => (turn ? { x: chair.y, y: chair.x, dir: SWAP_DIR[chair.dir] } : chair);
  const set = chairsFor(seats, chairs);
  const back = set.back.map(turnChair);
  const front = set.front.map(turnChair);
  const topTone = { t: top, l: side, r: shade(side, 0.1) };
  const places = (
    long
      ? [...(seats === 8 ? [-2.4, 0, 2.4] : [-1.4, 1.4]).flatMap((x) => [[x, -0.78], [x, 0.78]] as const)]
      : seats >= 4
        ? ([[0, -0.78], [0, 0.78], [-0.78, 0], [0.78, 0]] as const)
        : chairs === "left-right"
          ? ([[-0.78, 0], [0.78, 0]] as const)
          : ([[0, -0.78], [0, 0.78]] as const)
  ).map(([px, py]) => at(px, py));

  let tableBody;
  if (shape === "square") {
    tableBody = (
      <>
        {(long ? [-(half - 1.2), half - 1.2] : [0]).map((px) => (
          <IsoBox key={px} {...box(px - 0.25, -0.25, 0.5, 0.5)} h={z} c={PALETTE.pedestal} />
        ))}
        <IsoBox {...box(-half, -1.3, half * 2, 2.6)} z={z} h={0.25} c={topTone} />
      </>
    );
  } else if (!long) {
    tableBody = (
      <>
        <Cyl x={0} y={0} r={0.22} h={z} top="#bcb6b0" side="#a8a29e" />
        <Cyl x={0} y={0} z={z} r={1.38} h={0.25} top={top} side={side} />
      </>
    );
  } else {
    // Long round table: a capsule (two half-round ends and a straight middle), back end first.
    const end = half - 1.3;
    tableBody = (
      <>
        {[-end, end].map((px) => (
          <Cyl key={px} x={at(px, 0)[0]} y={at(px, 0)[1]} r={0.22} h={z} top="#bcb6b0" side="#a8a29e" />
        ))}
        <Cyl x={at(-end, 0)[0]} y={at(-end, 0)[1]} z={z} r={1.3} h={0.25} top={top} side={side} />
        <IsoBox {...box(-end, -1.3, end * 2, 2.6)} z={z} h={0.25} c={topTone} />
        <Cyl x={at(end, 0)[0]} y={at(end, 0)[1]} z={z} r={1.3} h={0.25} top={top} side={side} />
      </>
    );
  }

  return (
    <g>
      {back.map((chair) => (
        <ChairArt key={`${chair.dir}${chair.x},${chair.y}`} chair={chair} />
      ))}
      {tableBody}
      {food === "plates"
        ? places.map(([px, py]) => (
            <g key={`${px},${py}`}>
              <Disc x={px} y={py} z={TABLE_TOP_Z} r={0.3} fill="#ffffff" stroke="#e2ded9" strokeWidth={0.6} />
              <Disc x={px} y={py} z={TABLE_TOP_Z} r={0.13} fill="#f2c879" />
            </g>
          ))
        : null}
      {food === "plates" ? (
        <>
          <Disc x={0} y={0} z={TABLE_TOP_Z} r={0.52} fill="#d98a3d" />
          <Disc x={0} y={0} z={TABLE_TOP_Z} r={0.43} fill="#f3c568" />
          {[[-0.15, -0.1], [0.18, 0.05], [-0.02, 0.2], [0.12, -0.2]].map(([dx, dy]) => (
            <Disc key={`${dx},${dy}`} x={dx!} y={dy!} z={TABLE_TOP_Z} r={0.07} fill="#c2410c" />
          ))}
        </>
      ) : null}
      {food === "water"
        ? [[-0.35, -0.2], [0.35, -0.25], [0, 0.3], [-0.3, 0.35]].map(([dx, dy]) => (
            <Cyl key={`${dx},${dy}`} x={dx!} y={dy!} z={TABLE_TOP_Z} r={0.11} h={0.38} top="#ffffff" side="#dcd8d3" />
          ))
        : null}
      {front.map((chair) => (
        <ChairArt key={`${chair.dir}${chair.x},${chair.y}`} chair={chair} />
      ))}
    </g>
  );
}

// ── Delivery motorbike ──────────────────────────────────────────────────────

/** Local motorbike coordinates (a = away from the door, b = along the wall, z) → world. */
export type MotoFrame = (a: number, b: number, z: number) => [number, number, number];

function frameBox(toWorld: MotoFrame, a: number, b: number, z: number, wa: number, wb: number) {
  const p0 = toWorld(a, b, z);
  const p1 = toWorld(a + wa, b + wb, z);
  return { x: Math.min(p0[0], p1[0]), y: Math.min(p0[1], p1[1]), z: p0[2], w: Math.abs(p1[0] - p0[0]), d: Math.abs(p1[1] - p0[1]) };
}

/**
 * The mock-up's delivery motorbike with its rider, in any orientation: `toWorld` maps its local axes (a points
 * away from the door) to the world.
 */
export function MotoArt({ toWorld, speedLines }: { toWorld: MotoFrame; speedLines: boolean }) {
  const box = (a: number, b: number, z: number, wa: number, wb: number, h: number, c: ReturnType<typeof tone>) => {
    const r = frameBox(toWorld, a, b, z, wa, wb);
    return <IsoBox x={r.x} y={r.y} z={r.z} w={r.w} d={r.d} h={h} c={c} />;
  };
  const origin = project(...toWorld(0, 0, 0));
  const unitA = project(...toWorld(1, 0, 0));
  const axis = [unitA[0] - origin[0], unitA[1] - origin[1]];
  const wheel = (a: number, r: number) => {
    const [px, py] = project(...toWorld(a, 0, -1 + r));
    return (
      <g transform={`matrix(${r1(axis[0]! * r)},${r1(axis[1]! * r)},0,${r1(-ISO_UNIT * r)},${r1(px)},${r1(py)})`}>
        <circle r={1} fill="#292524" />
        <circle r={0.42} fill="#a8a29e" />
      </g>
    );
  };
  const light = tone("#efedeb");
  const rider = toWorld(3.4, 0, -0.2);
  return (
    <g>
      {speedLines
        ? (
            [
              [1.4, -0.4, 0.05],
              [0.9, -0.1, 0.25],
              [1.2, 0.2, -0.15],
            ] as const
          ).map(([a, b, z]) => (
            <Line3 key={`${a}${b}`} from={toWorld(a, b, z)} to={toWorld(a - 1.1, b, z)} stroke="#c9c2bb" strokeWidth={1.6} strokeLinecap="round" />
          ))
        : null}
      {wheel(2.5, 0.42)}
      {wheel(4.6, 0.42)}
      {box(2.5, -0.3, -0.65, 2, 0.6, 0.45, light)}
      {box(1.95, -0.5, -0.25, 1, 1, 1, PALETTE.brand)}
      <Poly points={[toWorld(2.25, 0.5, 0.15), toWorld(2.65, 0.5, 0.15), toWorld(2.65, 0.5, 0.5), toWorld(2.25, 0.5, 0.5)]} fill="#ffffff" />
      {box(2.95, -0.25, -0.2, 0.9, 0.5, 0.16, PALETTE.ink)}
      <Person x={rider[0]} y={rider[1]} z={rider[2]} look={{ body: "#2563eb", top: "#3b82f6", helmet: "#f5f5f4" }} />
      {box(4.3, -0.25, -0.65, 0.35, 0.5, 1.25, light)}
      {box(4.35, -0.65, 0.55, 0.25, 1.3, 0.12, PALETTE.ink)}
    </g>
  );
}
