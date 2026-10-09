import { SLUG_MAX_LENGTH, slugify, slugProblem, withSuffix } from "./slug";

describe("slugify", () => {
  it.each([
    ["La Picá de Juan!", "la-pica-de-juan"],
    ["Café Ñuñoa", "cafe-nunoa"],
    ["  Sushi   &   Rolls  ", "sushi-rolls"],
    ["El Rincón #2", "el-rincon-2"],
    ["---", ""],
    ["🍕🍕", ""],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("truncates to the maximum length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(SLUG_MAX_LENGTH - 1)} bbbb`);

    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("slugProblem", () => {
  it.each([
    ["la-pica", null],
    ["ab", "too_short"],
    ["a".repeat(SLUG_MAX_LENGTH + 1), "too_long"],
    ["La-Pica", "invalid_characters"],
    ["la--pica", "invalid_characters"],
    ["-lapica", "invalid_characters"],
    ["la_pica", "invalid_characters"],
    ["admin", "reserved"],
    ["api", "reserved"],
  ])("%s → %s", (slug, problem) => {
    expect(slugProblem(slug)).toBe(problem);
  });
});

describe("withSuffix", () => {
  it("appends the number", () => {
    expect(withSuffix("la-pica", 2)).toBe("la-pica-2");
  });

  it("stays within the maximum length", () => {
    const long = "a".repeat(SLUG_MAX_LENGTH);

    expect(withSuffix(long, 12)).toHaveLength(SLUG_MAX_LENGTH);
    expect(slugProblem(withSuffix(long, 12))).toBeNull();
  });
});
