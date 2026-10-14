import { createContext, type ReactNode, type SVGProps, useContext } from "react";
import { ISO_UNIT, isoPoints, project, r1, type Tone, tone, type Vec3 } from "@/lib/live-floor";

/**
 * SVG building blocks of the isometric scene (ported from the approved mock-up `docs/vista-en-vivo-concepto.html`).
 * Coordinates are world units (see `project` in lib/live-floor); colors are plain hex, since the drawing keeps
 * the mock-up's palette instead of the theme tokens.
 */

/** Ids of the scene's gradients and filters, unique per scene (two scenes may be on the page at once). */
export interface SceneIds {
  cylShade: string;
  dome: string;
  fire: string;
  blur: string;
  soft: string;
  soft2: string;
  roadGradient: string;
  roadFade: string;
}

export function sceneIds(prefix: string): SceneIds {
  const clean = prefix.replace(/[^\w-]/g, "");
  const id = (name: string) => `${clean}-${name}`;
  return {
    cylShade: id("cyl"),
    dome: id("dome"),
    fire: id("fire"),
    blur: id("blur"),
    soft: id("soft"),
    soft2: id("soft2"),
    roadGradient: id("road-g"),
    roadFade: id("road-fade"),
  };
}

export const SceneIdsContext = createContext<SceneIds>(sceneIds("lf"));
export const useSceneIds = () => useContext(SceneIdsContext);
export const url = (id: string) => `url(#${id})`;

/** The mock-up's palette (same base colors and face shading). */
export const PALETTE = {
  wall: tone("#f8f3ed", 0.04, 0.1),
  slab: tone("#e9e1d8", 0.08, 0.16),
  steel: tone("#e9e7e4", 0.08, 0.17),
  wood: tone("#f1e3d2", 0.06, 0.13),
  chair: tone("#d2ab83", 0.08, 0.17),
  brick: tone("#e3cdbb", 0.08, 0.16),
  kraft: tone("#e0c29c", 0.07, 0.15),
  ink: tone("#292524", 0.1, 0.2),
  light: tone("#efedeb"),
  brand: { t: "#e0602a", l: "#c2410c", r: "#a3370a" } satisfies Tone,
  pedestal: tone("#a8a29e", 0.08, 0.16),
};

export function Poly({ points, ...rest }: { points: readonly Vec3[] } & Omit<SVGProps<SVGPolygonElement>, "points">) {
  return <polygon points={isoPoints(points)} {...rest} />;
}

/** A line between two world points. */
export function Line3({ from, to, ...rest }: { from: Vec3; to: Vec3 } & Omit<SVGProps<SVGLineElement>, "from" | "to">) {
  const a = project(from[0], from[1], from[2] ?? 0);
  const b = project(to[0], to[1], to[2] ?? 0);
  return <line x1={r1(a[0])} y1={r1(a[1])} x2={r1(b[0])} y2={r1(b[1])} {...rest} />;
}

/** Box: `w` along x, `d` along y, `h` up. Visible faces: top, +y (left on screen) and +x (right). */
export function IsoBox({ x, y, z = 0, w, d, h, c, children, ...rest }: {
  x: number;
  y: number;
  z?: number;
  w: number;
  d: number;
  h: number;
  c: Tone;
  children?: ReactNode;
} & Omit<SVGProps<SVGGElement>, "x" | "y" | "z" | "d">) {
  const x2 = x + w;
  const y2 = y + d;
  const z2 = z + h;
  return (
    <g {...rest}>
      <Poly points={[[x, y2, z], [x2, y2, z], [x2, y2, z2], [x, y2, z2]]} fill={c.l} />
      <Poly points={[[x2, y, z], [x2, y2, z], [x2, y2, z2], [x2, y, z2]]} fill={c.r} />
      <Poly points={[[x, y, z2], [x2, y, z2], [x2, y2, z2], [x, y2, z2]]} fill={c.t} />
      {children}
    </g>
  );
}

/** A circle of radius r (world units) on a horizontal plane, as its projected ellipse. */
export function ellipseOf(x: number, y: number, z: number, r: number) {
  const [X, Y] = project(x, y, z);
  return { X, Y, rx: r * ISO_UNIT * 1.2247, ry: r * ISO_UNIT * 0.7071 };
}

export function Disc({ x, y, z = 0, r, ...rest }: { x: number; y: number; z?: number; r: number } & Omit<SVGProps<SVGEllipseElement>, "x" | "y" | "z" | "r">) {
  const e = ellipseOf(x, y, z, r);
  return <ellipse cx={r1(e.X)} cy={r1(e.Y)} rx={r1(e.rx)} ry={r1(e.ry)} {...rest} />;
}

/** Upright cylinder with a soft side shading. */
export function Cyl({ x, y, z = 0, r, h, top, side, ...rest }: {
  x: number;
  y: number;
  z?: number;
  r: number;
  h: number;
  top: string;
  side: string;
} & Omit<SVGProps<SVGGElement>, "x" | "y" | "z" | "r">) {
  const ids = useSceneIds();
  const e = ellipseOf(x, y, z, r);
  const ty = e.Y - h * ISO_UNIT;
  const d = `M${r1(e.X - e.rx)},${r1(ty)} L${r1(e.X - e.rx)},${r1(e.Y)} A${r1(e.rx)},${r1(e.ry)} 0 0 0 ${r1(e.X + e.rx)},${r1(e.Y)} L${r1(e.X + e.rx)},${r1(ty)} Z`;
  return (
    <g {...rest}>
      <path d={d} fill={side} />
      <path d={d} fill={url(ids.cylShade)} />
      <ellipse cx={r1(e.X)} cy={r1(ty)} rx={r1(e.rx)} ry={r1(e.ry)} fill={top} />
    </g>
  );
}

/** Text painted on a plane: the floor, the back wall facing +y, or a wall facing +x (reads towards −y). */
export function IsoText({ x, y, z = 0, plane, children, ...rest }: {
  x: number;
  y: number;
  z?: number;
  plane: "floor" | "wallY" | "wallX";
  children: ReactNode;
} & Omit<SVGProps<SVGTextElement>, "x" | "y" | "z">) {
  const [px, py] = project(x, y, z);
  const matrix = plane === "floor" ? "0.866,0.5,-0.866,0.5" : plane === "wallY" ? "0.866,0.5,0,1" : "0.866,-0.5,0,1";
  return (
    <text transform={`matrix(${matrix},${r1(px)},${r1(py)})`} {...rest}>
      {children}
    </text>
  );
}

export interface PersonLook {
  body: string;
  top?: string;
  skin?: string;
  hair?: string;
  /** Chef's hat. */
  hat?: boolean;
  /** Rider's helmet color. */
  helmet?: string;
}

/** A person: a cylinder body and a round head (with a chef's hat, a helmet or hair). */
export function Person({ x, y, z = 0, look }: { x: number; y: number; z?: number; look: PersonLook }) {
  const [hxRaw, hyRaw] = project(x, y, z + 2.1);
  const hx = r1(hxRaw);
  const hy = r1(hyRaw);
  return (
    <g>
      <Cyl x={x} y={y} z={z} r={0.34} h={1.72} top={look.top ?? look.body} side={look.body} />
      <circle cx={hx} cy={hy} r={5} fill={look.skin ?? "#e2ad85"} />
      {look.hat ? (
        <>
          <rect x={hx - 4} y={hy - 11} width={8} height={7} rx={1.5} fill="#ffffff" stroke="#e7e5e4" strokeWidth={0.7} />
          <circle cx={hx} cy={hy - 11} r={4.8} fill="#ffffff" stroke="#e7e5e4" strokeWidth={0.7} />
        </>
      ) : look.helmet ? (
        <>
          <path d={`M${hx - 5.8},${hy + 1.2} A5.8,5.8 0 0 1 ${hx + 5.8},${hy + 1.2} Z`} fill={look.helmet} />
          <path d={`M${hx + 0.5},${hy - 1} h5 v2.6 h-5 Z`} fill="#1c1917" opacity={0.75} />
        </>
      ) : (
        <path d={`M${hx - 5},${hy - 0.3} A5,5 0 0 1 ${hx + 5},${hy - 0.3} Q${hx},${hy - 2.6} ${hx - 5},${hy - 0.3} Z`} fill={look.hair ?? "#3f2d22"} />
      )}
    </g>
  );
}

/** A potted plant. */
export function Plant({ x, y }: { x: number; y: number }) {
  const [px, py] = project(x, y, 1.3);
  return (
    <g>
      <Cyl x={x} y={y} r={0.5} h={0.8} top="#7a5c45" side="#c9a88a" />
      <circle cx={r1(px - 4)} cy={r1(py + 2)} r={7} fill="#5f8a63" />
      <circle cx={r1(px + 4)} cy={r1(py)} r={7.5} fill="#6f9a72" />
      <circle cx={r1(px)} cy={r1(py - 6)} r={7} fill="#82ab83" />
    </g>
  );
}
