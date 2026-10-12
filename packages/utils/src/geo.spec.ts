import { geoAreaProblem, isGeoPoint, isPointInArea, roundCoord } from "./geo";

// A square around Plaza Ñuñoa (Santiago).
const square = [
  { lat: -33.45, lng: -70.6 },
  { lat: -33.45, lng: -70.59 },
  { lat: -33.46, lng: -70.59 },
  { lat: -33.46, lng: -70.6 },
];

describe("geo", () => {
  it("rounds coordinates to 6 decimals", () => {
    expect(roundCoord(-33.456789123)).toBe(-33.456789);
  });

  it("recognizes valid points", () => {
    expect(isGeoPoint({ lat: -33.4, lng: -70.6 })).toBe(true);
    expect(isGeoPoint({ lat: -91, lng: 0 })).toBe(false);
    expect(isGeoPoint({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isGeoPoint({ lat: "-33", lng: -70 })).toBe(false);
  });

  it("validates a drawn area", () => {
    expect(geoAreaProblem(square)).toBeNull();
    expect(geoAreaProblem(square.slice(0, 2))).toBe("vertices");
    expect(geoAreaProblem([...square.slice(0, 3), { lat: 200, lng: 0 }])).toBe("coordinates");
    expect(geoAreaProblem([square[0], square[0], square[1], square[2]])).toBe("repeated");
    expect(geoAreaProblem(null)).toBe("vertices");
  });

  it("tells whether a point falls inside an area", () => {
    expect(isPointInArea({ lat: -33.455, lng: -70.595 }, square)).toBe(true);
    expect(isPointInArea({ lat: -33.47, lng: -70.595 }, square)).toBe(false);
    expect(isPointInArea({ lat: -33.455, lng: -70.58 }, square)).toBe(false);
  });
});
