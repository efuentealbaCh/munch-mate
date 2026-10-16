import type { DecorKind, FloorMaterial } from "@app/types";
import type { CSSProperties, ReactNode } from "react";
import { MATERIAL_LOOKS } from "@/lib/floor-materials";

/** Hatching of cells outside the building: they are not drawn in the live view, so they must not look like floor. */
const VOID_STYLE: CSSProperties = {
  backgroundColor: "#fafaf9",
  backgroundImage: "repeating-linear-gradient(45deg, #d6d3d1 0 1.5px, transparent 1.5px 6px)",
};

/**
 * How a cell of a material looks from above in the editor: its color from MATERIAL_LOOKS plus a subtle pattern
 * (planks, tiles, dots, flagstones, grass), sized relative to the cell so it reads the same at any zoom.
 */
export function materialStyle(material: FloorMaterial): CSSProperties {
  const { top, side, accent } = MATERIAL_LOOKS[material];
  switch (material) {
    case "wood":
      return { backgroundColor: top, backgroundImage: `repeating-linear-gradient(180deg, transparent 0 22%, ${accent} 22% 25%)` };
    case "tile":
      return {
        backgroundColor: top,
        backgroundImage: `linear-gradient(${accent} 1.5px, transparent 1.5px), linear-gradient(90deg, ${accent} 1.5px, transparent 1.5px)`,
        backgroundSize: "50% 50%",
      };
    case "carpet":
      return { backgroundColor: top, backgroundImage: `radial-gradient(${accent} 18%, transparent 22%)`, backgroundSize: "25% 25%" };
    case "stone":
      return {
        backgroundColor: top,
        // Large slabs with a soft sheen: a checkerboard here read as "transparent" and was confused with the void.
        backgroundImage: `linear-gradient(${accent} 2px, transparent 2px), linear-gradient(90deg, ${accent} 2px, transparent 2px), linear-gradient(135deg, rgba(255,255,255,.45), transparent 55%)`,
        backgroundSize: "100% 50%, 50% 100%, 100% 100%",
        backgroundPosition: "0 0, 25% 0, 0 0",
      };
    case "grass":
      return {
        backgroundColor: top,
        backgroundImage: [
          `radial-gradient(circle at 25% 30%, ${accent} 9%, transparent 11%)`,
          `radial-gradient(circle at 70% 60%, ${accent} 9%, transparent 11%)`,
          `radial-gradient(circle at 40% 85%, ${accent} 7%, transparent 9%)`,
        ].join(", "),
      };
    case "wall":
      // Darker rim and a thicker lower edge, so a run of walls reads as raised.
      return { backgroundColor: top, boxShadow: `inset 0 0 0 2px ${side}, inset 0 -5px 0 ${side}` };
    case "void":
      return VOID_STYLE;
    case "floor":
      return { backgroundColor: top };
  }
}

/** Top-view drawings of the decorations (24 × 24 viewBox). */
const DECOR_SHAPES: Record<DecorKind, ReactNode> = {
  plant: (
    <>
      <circle cx="12" cy="12" r="7" fill="#a8a29e" />
      <circle cx="12" cy="12" r="5.5" fill="#78716c" />
      <path d="M12 4.5c2 2.5 2 5 0 7.5-2-2.5-2-5 0-7.5Z" fill="#4d7c0f" />
      <path d="M19.5 12c-2.5 2-5 2-7.5 0 2.5-2 5-2 7.5 0Z" fill="#65a30d" />
      <path d="M12 19.5c-2-2.5-2-5 0-7.5 2 2.5 2 5 0 7.5Z" fill="#4d7c0f" />
      <path d="M4.5 12c2.5-2 5-2 7.5 0-2.5 2-5 2-7.5 0Z" fill="#65a30d" />
    </>
  ),
  planter: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="1.5" fill="#a16207" />
      <rect x="4" y="8.5" width="16" height="7" rx="1" fill="#57534e" />
      <circle cx="7.5" cy="12" r="2.6" fill="#65a30d" />
      <circle cx="12" cy="12" r="2.6" fill="#4d7c0f" />
      <circle cx="16.5" cy="12" r="2.6" fill="#65a30d" />
    </>
  ),
  tree: (
    <>
      <circle cx="12" cy="12" r="10" fill="#3f6212" />
      <circle cx="10" cy="10" r="6.5" fill="#4d7c0f" />
      <circle cx="14.5" cy="14" r="4.5" fill="#65a30d" />
      <circle cx="9" cy="8.5" r="2.5" fill="#84cc16" opacity="0.7" />
    </>
  ),
  flowers: (
    <>
      <circle cx="12" cy="12" r="9" fill="#65a30d" />
      <circle cx="8" cy="9" r="2.4" fill="#f472b6" />
      <circle cx="15.5" cy="8.5" r="2.2" fill="#facc15" />
      <circle cx="12" cy="13.5" r="2.4" fill="#f87171" />
      <circle cx="7.5" cy="15.5" r="2" fill="#facc15" />
      <circle cx="16" cy="15.5" r="2.2" fill="#c084fc" />
    </>
  ),
  lamp: (
    <>
      <circle cx="12" cy="12" r="9.5" fill="#fde68a" opacity="0.6" />
      <circle cx="12" cy="12" r="5.5" fill="#fbbf24" />
      <circle cx="12" cy="12" r="2.5" fill="#44403c" />
    </>
  ),
  umbrella: (
    <>
      <circle cx="12" cy="12" r="10" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.75" />
      <path d="M12 12 12 2A10 10 0 0 1 19.07 4.93ZM12 12 22 12A10 10 0 0 1 19.07 19.07ZM12 12 12 22A10 10 0 0 1 4.93 19.07ZM12 12 2 12A10 10 0 0 1 4.93 4.93Z" fill="#dc2626" />
      <circle cx="12" cy="12" r="1.3" fill="#44403c" />
    </>
  ),
  bench: (
    <>
      <rect x="2" y="7.5" width="20" height="9" rx="1.5" fill="#92400e" />
      <rect x="3" y="8.5" width="18" height="2" rx="0.5" fill="#d97706" />
      <rect x="3" y="11" width="18" height="2" rx="0.5" fill="#b45309" />
      <rect x="3" y="13.5" width="18" height="2" rx="0.5" fill="#d97706" />
    </>
  ),
};

/** A decoration seen from above; decorative only (the caller labels it with DECOR_LABELS). */
export function DecorIcon({ kind, className }: { kind: DecorKind; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" className={className}>
      {DECOR_SHAPES[kind]}
    </svg>
  );
}
