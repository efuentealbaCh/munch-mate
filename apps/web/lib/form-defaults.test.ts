import { describe, expect, it } from "vitest";
import { type FieldElementLike, type FormRootLike, domTypedValueReader, mergeTypedValues, typedDefaults } from "./form-defaults";

/** Plain-object stand-in for a server-rendered element (vitest runs in node, without a DOM). */
function field(name: string, value: string, tagName = "INPUT", type?: string): FieldElementLike {
  return { tagName, value, ...(type === undefined ? {} : { type }), getAttribute: (attr) => (attr === "name" ? name : null) };
}

/** A document holding one form per `data-form` id, each with its named controls. */
function fakeDocument(forms: Record<string, FieldElementLike[]>): FormRootLike & { selectors: string[] } {
  const selectors: string[] = [];
  return {
    selectors,
    querySelector(selector) {
      selectors.push(selector);
      const id = /^form\[data-form="([^"]+)"\]$/.exec(selector)?.[1];
      const controls = id ? forms[id] : undefined;
      return controls ? { querySelectorAll: (inner) => (inner === "[name]" ? controls : []) } : null;
    },
  };
}

describe("mergeTypedValues", () => {
  it("returns the same defaults object when nothing was typed", () => {
    const defaults = { email: "", password: "" };
    expect(mergeTypedValues(defaults, () => null)).toBe(defaults);
  });

  it("replaces string defaults with typed values, without mutating the defaults", () => {
    const defaults = { email: "", password: "" };
    const typed: Record<string, string> = { email: "ana@example.com" };
    expect(mergeTypedValues(defaults, (name) => typed[name] ?? null)).toEqual({ email: "ana@example.com", password: "" });
    expect(defaults).toEqual({ email: "", password: "" });
  });

  it("keeps a prefilled default when nothing was typed and prefers what was typed otherwise", () => {
    const defaults = { name: "", email: "invitada@example.com" };
    expect(mergeTypedValues(defaults, () => null)).toEqual(defaults);
    expect(mergeTypedValues(defaults, (name) => (name === "email" ? "otra@example.com" : null)).email).toBe("otra@example.com");
  });

  it("only considers fields whose default is a string", () => {
    const defaults = { note: "", count: 1, remember: false, address: { street: "" } };
    const read = () => "escrito";
    expect(mergeTypedValues(defaults, read)).toEqual({ note: "escrito", count: 1, remember: false, address: { street: "" } });
  });
});

describe("domTypedValueReader", () => {
  it("reads text-like controls of the right form only", () => {
    const doc = fakeDocument({
      login: [field("email", "ana@example.com", "INPUT", "email"), field("password", "secreto", "INPUT", "password")],
      "forgot-password": [field("email", "otra@example.com", "INPUT", "email")],
    });
    const read = domTypedValueReader("forgot-password", doc);
    expect(read("email")).toBe("otra@example.com");
    expect(read("password")).toBeNull();
    expect(doc.selectors).toEqual(['form[data-form="forgot-password"]']);
  });

  it.each([
    ["text input", field("name", "Ana", "INPUT", "text"), "Ana"],
    ["input without type", field("name", "Ana", "input"), "Ana"],
    ["tel input", field("name", "+56 9 1234 5678", "INPUT", "tel"), "+56 9 1234 5678"],
    ["textarea", field("name", "sin cebolla", "TEXTAREA"), "sin cebolla"],
    ["empty text input", field("name", "", "INPUT", "text"), null],
    ["checkbox", field("name", "on", "INPUT", "checkbox"), null],
    ["radio", field("name", "cash", "INPUT", "radio"), null],
    ["hidden input", field("name", "x", "INPUT", "hidden"), null],
    ["select", field("name", "zone-1", "SELECT", "select-one"), null],
  ])("%s", (_label, control, expected) => {
    expect(domTypedValueReader("f", fakeDocument({ f: [control] }))("name")).toBe(expected);
  });

  it("ignores ambiguous names inside the form", () => {
    const doc = fakeDocument({ f: [field("email", "a@example.com"), field("email", "b@example.com")] });
    expect(domTypedValueReader("f", doc)("email")).toBeNull();
  });

  it("returns null for every field when the form is not in the document", () => {
    expect(domTypedValueReader("login", fakeDocument({}))("email")).toBeNull();
  });
});

describe("typedDefaults", () => {
  it("returns the defaults unchanged without a document (server render)", () => {
    const defaults = { email: "" };
    expect(typeof document).toBe("undefined");
    expect(typedDefaults("login", defaults)).toBe(defaults);
  });
});
