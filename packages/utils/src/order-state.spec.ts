import { checkTransition, nextStatuses } from "./order-state";

const kitchen = { kind: "staff" as const, roles: ["kitchen" as const] };
const rider = { kind: "staff" as const, roles: ["rider" as const] };
const customer = { kind: "customer" as const };

describe("checkTransition (dine_in)", () => {
  it("follows the happy path", () => {
    expect(checkTransition("dine_in", "pending", "accepted", kitchen)).toEqual({ ok: true, requiresReason: false, requiresReadyTime: false });
    expect(checkTransition("dine_in", "accepted", "preparing", kitchen).ok).toBe(true);
    expect(checkTransition("dine_in", "preparing", "ready", kitchen).ok).toBe(true);
    expect(checkTransition("dine_in", "ready", "served", kitchen).ok).toBe(true);
  });

  it("requires a reason to reject", () => {
    expect(checkTransition("dine_in", "pending", "rejected", kitchen)).toEqual({ ok: true, requiresReason: true, requiresReadyTime: false });
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

describe("checkTransition (pickup)", () => {
  it("asks for a ready time when accepting and ends in picked_up", () => {
    expect(checkTransition("pickup", "pending", "accepted", kitchen)).toEqual({
      ok: true,
      requiresReason: false,
      requiresReadyTime: true,
    });
    expect(checkTransition("pickup", "accepted", "preparing", kitchen).ok).toBe(true);
    expect(checkTransition("pickup", "preparing", "ready", kitchen).ok).toBe(true);
    expect(checkTransition("pickup", "ready", "picked_up", kitchen).ok).toBe(true);
  });

  it("never serves a pickup order nor picks up a dine-in one", () => {
    expect(checkTransition("pickup", "ready", "served", kitchen)).toEqual({ ok: false, reason: "invalid_transition" });
    expect(checkTransition("dine_in", "ready", "picked_up", kitchen)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("lets the customer cancel only while pending, and riders do nothing", () => {
    expect(checkTransition("pickup", "pending", "cancelled", customer).ok).toBe(true);
    expect(checkTransition("pickup", "accepted", "cancelled", customer)).toEqual({ ok: false, reason: "forbidden" });
    expect(checkTransition("pickup", "pending", "accepted", rider)).toEqual({ ok: false, reason: "forbidden" });
    expect(nextStatuses("pickup", "ready", kitchen)).toEqual(["picked_up"]);
  });
});

describe("checkTransition (delivery)", () => {
  it("asks for an ETA when accepting and lets riders take it out and hand it over", () => {
    expect(checkTransition("delivery", "pending", "accepted", kitchen)).toEqual({
      ok: true,
      requiresReason: false,
      requiresReadyTime: true,
    });
    expect(checkTransition("delivery", "ready", "out_for_delivery", rider).ok).toBe(true);
    expect(checkTransition("delivery", "out_for_delivery", "delivered", rider).ok).toBe(true);
    expect(checkTransition("delivery", "ready", "out_for_delivery", kitchen).ok).toBe(true);
  });

  it("keeps riders out of the kitchen steps and never picks up a delivery", () => {
    expect(checkTransition("delivery", "pending", "accepted", rider)).toEqual({ ok: false, reason: "forbidden" });
    expect(checkTransition("delivery", "preparing", "ready", rider)).toEqual({ ok: false, reason: "forbidden" });
    expect(checkTransition("delivery", "ready", "picked_up", kitchen)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    expect(nextStatuses("delivery", "out_for_delivery", rider)).toEqual(["delivered"]);
  });
});

describe("cancelling", () => {
  it("asks the staff for a reason (the customer sees it), in every channel", () => {
    for (const channel of ["dine_in", "pickup", "delivery"] as const) {
      expect(checkTransition(channel, "pending", "cancelled", kitchen)).toMatchObject({ ok: true, requiresReason: true });
      expect(checkTransition(channel, "accepted", "cancelled", kitchen)).toMatchObject({ ok: true, requiresReason: true });
    }
  });
});
