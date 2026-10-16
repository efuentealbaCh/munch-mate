import type { DecorKind, FloorMaterial } from "@app/types";

/**
 * Catalog of what the owner paints and places on the floor plan (terrain materials and decorations), shared by
 * the editor (top view) and the live view (isometric), so both draw the same palette. Purely visual: the rules
 * (walls and void keep tables out) live in `floorPlanProblem` (@app/utils).
 */

/** How a material looks: `top` is the color seen from above; `side` the darker face of raised cells (walls). */
export interface MaterialLook {
  label: string;
  /** Short hint for the palette button. */
  hint: string;
  top: string;
  side: string;
  /** Second color for the pattern (planks, tiles, grass blades); same as `top` for plain ones. */
  accent: string;
}

/** In the order the editor's palette shows them. */
export const MATERIAL_ORDER: readonly FloorMaterial[] = ["floor", "wood", "tile", "carpet", "stone", "grass", "wall", "void"];

export const MATERIAL_LOOKS: Record<FloorMaterial, MaterialLook> = {
  floor: { label: "Piso", hint: "Piso base del local", top: "#f5f2ee", side: "#e2ddd6", accent: "#ebe6df" },
  wood: { label: "Madera", hint: "Piso de madera", top: "#e3c7a1", side: "#c9a57a", accent: "#d6b68c" },
  tile: { label: "Baldosa", hint: "Baldosa o cerámica", top: "#e9eef0", side: "#cfd8dc", accent: "#d5dde1" },
  carpet: { label: "Alfombra", hint: "Alfombra o zona lounge", top: "#d9a7a0", side: "#bf857d", accent: "#cc958d" },
  stone: { label: "Terraza", hint: "Piedra o concreto de terraza", top: "#d6d3d1", side: "#a8a29e", accent: "#c7c3c0" },
  grass: { label: "Pasto", hint: "Jardín o patio", top: "#b9d89a", side: "#8fb86c", accent: "#a5cb82" },
  wall: { label: "Muro", hint: "Muro o tabique: no admite mesas", top: "#a8a29e", side: "#78716c", accent: "#8f8984" },
  void: { label: "Vacío", hint: "Fuera del local: no se dibuja", top: "transparent", side: "transparent", accent: "transparent" },
};

/** In the order the editor's palette shows them. */
export const DECOR_ORDER: readonly DecorKind[] = ["plant", "planter", "tree", "flowers", "lamp", "umbrella", "bench"];

export const DECOR_LABELS: Record<DecorKind, string> = {
  plant: "Planta",
  planter: "Macetero",
  tree: "Árbol",
  flowers: "Flores",
  lamp: "Lámpara",
  umbrella: "Quitasol",
  bench: "Banca",
};
