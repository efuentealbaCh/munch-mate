import { checkTransition, nextStatuses } from "./order-state";

const kitchen = { kind: "staff" as const, roles: ["kitchen" as const] };
const rider = { kind: "staff" as const, roles: ["rider" as const] };
const customer = { kind: "customer" as const };

describe("checkTransition (dine_in)", () => {
  it("follows the happy path", () => {
    expect(checkTransition("dine_in", "pending", "accepted", kitchen)).toEqual({ ok: true, requiresReason: false });
    expect(checkTransition("dine_in", "accepted", "preparing", kitchen).ok).toBe(true);
    expect(checkTransition("dine_in", "preparing", "ready", kitchen).ok).toBe(true);
    expect(checkTransition("dine_in", "ready", "served", kitchen).ok).toBe(true);
  });

  it("requires a reason to reject", () => {
    expect(checkTransition("dine_in", "pending", "rejected", kitchen)).toEqual({ ok: true, requiresReason: true });
  });

  it("rejects transitions the state machine does not have", () => {
    expect(checkTransition("dine_in", "pending", "ready", kitchen)).toEqual({ ok: false, reason: "invalid_transition" });
    expect(checkTransition("dine_in", "served", "pending", kitchen)).toEqual({ ok: false, reason: "invalid_transition" });
    expect(checkTransition("dine_in", "preparing", "cancelled", kitchen)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("lets the customer cancel only while pending, and nothing else", () => {
    expect(checkTransition("dine_in", "pending", "cancelled", customer).ok).toBe(true);
    expect(checkTransition("dine_in", "accepted", "cancelled", customer)).toEqual({ ok: false, reason: "forbidden" });
    expect(checkTransition("dine_in", "pending", "accepted", customer)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("does not let riders run the dine-in floor", () => {
    expect(checkTransition("dine_in", "pending", "accepted", rider)).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("nextStatuses", () => {
  it("lists the actions available to the actor, primary first", () => {
    expect(nextStatuses("dine_in", "pending", kitchen)).toEqual(["accepted", "rejected", "cancelled"]);
    expect(nextStatuses("dine_in", "pending", customer)).toEqual(["cancelled"]);
    expect(nextStatuses("dine_in", "served", kitchen)).toEqual([]);
  });
});
