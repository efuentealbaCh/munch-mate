import type { GeoPoint } from "@app/types";
import { geoAreaProblem } from "@app/utils";
import { describe, expect, it } from "vitest";
import {
  absoluteMapUrl,
  areaEditorReducer,
  areaPoints,
  areaProblemMessage,
  boundsOf,
  boxContains,
  formatAgo,
  geolocationFailure,
  hasDrawnZones,
  initialAreaEditor,
  insertionIndex,
  isStalePosition,
  pinProblem,
  reportDelay,
  RIDER_STALE_MS,
  samePoint,
  trackPosition,
  zoneAtPoint,
} from "./maps";

/** A square of ~1 km around (lat, lng). */
function square(lat: number, lng: number, half = 0.005): GeoPoint[] {
  return [
    { lat: lat - half, lng: lng - half },
    { lat: lat - half, lng: lng + half },
    { lat: lat + half, lng: lng + half },
    { lat: lat + half, lng: lng - half },
  ];
}

const providencia = { id: "p", name: "Providencia", area: square(-33.43, -70.61) };
const overlap = { id: "o", name: "Solapada", area: square(-33.43, -70.61, 0.01) };
const byName = { id: "n", name: "Ñuñoa", area: null };

describe("map urls", () => {
  it("makes api paths absolute without encoding the glyph placeholders", () => {
    expect(absoluteMapUrl("/api/public/maps/fonts/{fontstack}/{range}.pbf", "https://munch.cl")).toBe(
      "https://munch.cl/api/public/maps/fonts/{fontstack}/{range}.pbf",
    );
    expect(absoluteMapUrl("api/x.pmtiles", "https://munch.cl/")).toBe("https://munch.cl/api/x.pmtiles");
    expect(absoluteMapUrl("https://cdn.example/x.pmtiles", "https://munch.cl")).toBe("https://cdn.example/x.pmtiles");
  });
});

describe("zone of a pin", () => {
  it("knows when the checkout needs the map", () => {
    expect(hasDrawnZones([byName])).toBe(false);
    expect(hasDrawnZones([byName, providencia])).toBe(true);
  });

  it("picks the first drawn zone containing the pin, like the api", () => {
    const inside = { lat: -33.43, lng: -70.61 };
    expect(zoneAtPoint(inside, [byName, providencia, overlap])?.id).toBe("p");
    expect(zoneAtPoint(inside, [overlap, providencia])?.id).toBe("o");
    // Only inside the bigger one.
    expect(zoneAtPoint({ lat: -33.438, lng: -70.61 }, [providencia, overlap])?.id).toBe("o");
    expect(zoneAtPoint({ lat: -33.5, lng: -70.7 }, [byName, providencia])).toBeNull();
  });

  it("says what blocks the order on the pin side", () => {
    expect(pinProblem(byName, null)).toBeNull();
    expect(pinProblem(null, null)).toBeNull();
    expect(pinProblem(providencia, null)).toBe("missing");
    expect(pinProblem(providencia, { lat: -33.5, lng: -70.7 })).toBe("outside-zone");
    expect(pinProblem(providencia, { lat: -33.43, lng: -70.61 })).toBeNull();
  });

  it("compares pins at the stored precision", () => {
    expect(samePoint({ lat: -33.1234561, lng: -70.1 }, { lat: -33.1234559, lng: -70.1 })).toBe(true);
    expect(samePoint({ lat: -33.12345, lng: -70.1 }, { lat: -33.12346, lng: -70.1 })).toBe(false);
    expect(samePoint(null, null)).toBe(true);
    expect(samePoint(null, { lat: 0, lng: 0 })).toBe(false);
  });
});

describe("framing", () => {
  it("computes the box of the points", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ lat: -33, lng: -70 }])).toEqual([
      [-70, -33],
      [-70, -33],
    ]);
    const box = boundsOf([
      { lat: -33.4, lng: -70.6 },
      { lat: -33.5, lng: -70.5 },
      { lat: -33.45, lng: -70.7 },
    ]);
    expect(box).toEqual([
      [-70.7, -33.5],
      [-70.5, -33.4],
    ]);
    expect(boxContains(box!, { lat: -33.45, lng: -70.6 })).toBe(true);
    expect(boxContains(box!, { lat: -33.3, lng: -70.6 })).toBe(false);
  });

  it("collects the vertices of the drawn zones", () => {
    expect(areaPoints([byName, providencia])).toHaveLength(4);
  });
});

describe("polygon editor", () => {
  it("inserts a vertex on the closest edge once there is a shape", () => {
    const area = square(0, 0, 1); // (-1,-1) (-1,1) (1,1) (1,-1) as lat,lng
    expect(insertionIndex(area.slice(0, 2), { lat: 5, lng: 5 })).toBe(2);
    // Just outside the edge from vertex 1 (lat -1, lng 1) to vertex 2 (lat 1, lng 1).
    expect(insertionIndex(area, { lat: 0, lng: 1.2 })).toBe(2);
    // Next to the closing edge (vertex 3 back to vertex 0): appended at the end.
    expect(insertionIndex(area, { lat: 0, lng: -1.2 })).toBe(4);
  });

  it("adds, moves, removes, clears and undoes", () => {
    let state = initialAreaEditor(null);
    for (const point of square(-33.43, -70.61)) state = areaEditorReducer(state, { type: "add", point });
    expect(state.points).toHaveLength(4);
    expect(geoAreaProblem(state.points)).toBeNull();

    state = areaEditorReducer(state, { type: "move", index: 0, point: { lat: -33.44, lng: -70.62 } });
    expect(state.points[0]).toEqual({ lat: -33.44, lng: -70.62 });
    state = areaEditorReducer(state, { type: "undo" });
    expect(state.points[0]).toEqual(square(-33.43, -70.61)[0]);

    state = areaEditorReducer(state, { type: "remove", index: 3 });
    expect(state.points).toHaveLength(3);
    state = areaEditorReducer(state, { type: "clear" });
    expect(state.points).toEqual([]);
    state = areaEditorReducer(state, { type: "undo" });
    expect(state.points).toHaveLength(3);

    // Out of range edits and undo without history change nothing.
    expect(areaEditorReducer(state, { type: "move", index: 9, point: { lat: 0, lng: 0 } })).toBe(state);
    const fresh = initialAreaEditor([{ lat: 1, lng: 1 }]);
    expect(areaEditorReducer(fresh, { type: "undo" })).toBe(fresh);
    expect(areaEditorReducer(initialAreaEditor(null), { type: "clear" }).history).toEqual([]);
  });

  it("explains geoAreaProblem in Spanish", () => {
    expect(areaProblemMessage(geoAreaProblem(square(0, 0)), 4)).toBeNull();
    expect(areaProblemMessage(geoAreaProblem([{ lat: 0, lng: 0 }]), 1)).toBe("Marca al menos 3 puntos en el mapa (llevas 1).");
    const repeated = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, { lat: 1, lng: 1 }];
    expect(areaProblemMessage(geoAreaProblem(repeated), 3)).toContain("mismo lugar");
    expect(areaProblemMessage("coordinates", 3)).toContain("fuera del mapa");
    expect(areaProblemMessage("vertices", 201)).toContain("hasta 200 puntos");
  });
});

describe("rider reports", () => {
  it("sends at most one report per interval", () => {
    expect(reportDelay(null, 1_000)).toBe(0);
    expect(reportDelay(1_000, 2_000, 5_000)).toBe(4_000);
    expect(reportDelay(1_000, 6_000, 5_000)).toBe(0);
    expect(reportDelay(1_000, 9_000, 5_000)).toBe(0);
    // Device clock moved backwards: send instead of waiting forever.
    expect(reportDelay(10_000, 5_000, 5_000)).toBe(0);
  });
});

describe("position age", () => {
  it("formats how long ago", () => {
    expect(formatAgo(-3_000)).toBe("hace un momento");
    expect(formatAgo(4_999)).toBe("hace un momento");
    expect(formatAgo(12_400)).toBe("hace 12 s");
    expect(formatAgo(185_000)).toBe("hace 3 min");
    expect(formatAgo(2 * 3_600_000 + 5)).toBe("hace 2 h");
  });

  it("dates positions with the local clock and flags old ones", () => {
    const now = Date.parse("2026-10-09T15:00:00Z");
    const position = { lat: -33, lng: -70, accuracy: 8, at: "2026-10-09T14:59:30Z" };
    expect(trackPosition(position, now, true).seenAt).toBe(now);
    expect(trackPosition(position, now, false).seenAt).toBe(now - 30_000);
    // Server ahead of the device: never in the future.
    expect(trackPosition({ ...position, at: "2026-10-09T15:01:00Z" }, now, false).seenAt).toBe(now);
    expect(isStalePosition({ seenAt: now - RIDER_STALE_MS - 1 }, now)).toBe(true);
    expect(isStalePosition({ seenAt: now - 30_000 }, now)).toBe(false);
  });

  it("maps geolocation error codes", () => {
    expect(geolocationFailure({ code: 1 })).toBe("denied");
    expect(geolocationFailure({ code: 2 })).toBe("unavailable");
    expect(geolocationFailure({ code: 3 })).toBe("timeout");
  });
});
