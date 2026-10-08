import { type BrowserContext, expect, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, registerViaApi, runId, uniqueEmail, verifyEmailViaApi } from "./helpers";

/*
 * MVP gaps: opening hours (the public menu shows "Cerrado ahora · Abre …" and blocks ordering), the "Ventas"
 * daily summary, and the platform admin page hidden from regular owners. Runs last (file order) and registers
 * 1 user; registerViaApi waits out the 5/min registration limit when the earlier specs used it up.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const id = runId();
const ownerEmail = uniqueEmail("hours-owner");
const restaurantName = `Horario ${id}`;

/** Filled by the setup. */
const shared = { restaurantId: "", slug: "", timezone: "America/Santiago" };

/** Owner, open restaurant with pickup and one product of $3.500, via the api. */
async function setupRestaurant(context: BrowserContext): Promise<void> {
  const api = context.request;
  await registerViaApi(api, { name: "Hilda Dueña", email: ownerEmail });
  await verifyEmailViaApi(api, ownerEmail);
  const send = async (method: "post" | "patch" | "put", path: string, data: unknown, status = 201) => {
    const response = await api[method](path, { data, headers: ORIGIN_HEADER });
    expect(response.status(), await response.text()).toBe(status);
    return (await response.json()) as Record<string, unknown>;
  };
  const restaurant = await send("post", "/api/restaurants", { name: restaurantName });
  shared.restaurantId = String(restaurant.id);
  shared.slug = String(restaurant.slug);
  shared.timezone = String(restaurant.timezone);
  expect(restaurant.openingHours).toBeNull();
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send("patch", base, { pickupEnabled: true }, 200);
  await send("put", `${base}/accepting-orders`, { acceptingOrders: true }, 200);
  const category = await send("post", `${base}/menu/categories`, { name: "Sándwiches", description: "" });
  await send("post", `${base}/menu/products`, {
    categoryId: category.id,
    name: "Barros Luco",
    description: "Carne y queso fundido",
    price: 3500,
    visible: true,
    modifierGroupIds: [],
  });
}

/** "HH:MM" `hoursAhead` hours from now in the restaurant's zone (wraps past midnight). */
function localTimeIn(hoursAhead: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: shared.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() + hoursAhead * 3_600_000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

test("opening hours close the menu, removing them lets the customer order, and Ventas shows the total", async ({ browser }) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    await setupRestaurant(owner);
    const admin = await owner.newPage();
    const phone = await customer.newPage();

    // The owner sets every day to a range that starts 2 h from now: the restaurant is outside its hours now.
    await admin.goto(`/admin/${shared.restaurantId}`);
    const card = admin.locator('[data-slot="card"]').filter({ has: admin.getByRole("heading", { name: "Horario de atención" }) });
    const useHours = card.getByRole("switch", { name: /Usar horario/ });
    await expect(useHours).not.toBeChecked();
    await useHours.click();
    await card.getByLabel("Lunes, tramo 1: abre").fill(localTimeIn(2));
    await card.getByLabel("Lunes, tramo 1: cierra").fill(localTimeIn(3));
    await card.getByRole("button", { name: "Copiar el lunes a todos los días" }).click();
    await card.getByRole("button", { name: "Guardar horario" }).click();
    await expect(admin.getByText("Guardaste el horario de atención")).toBeVisible();
    await expect(card.getByTestId("schedule-status")).toContainText("fuera de horario");
    await expect(admin.getByTestId("open-badge")).toHaveText("Fuera de horario");

    // The board says why customers cannot order although the switch is on.
    await admin.goto(`/admin/${shared.restaurantId}/pedidos`);
    await expect(admin.getByRole("switch", { name: /Recibiendo pedidos/ })).toBeChecked();
    await expect(admin.getByTestId("outside-hours")).toContainText("Fuera de horario");

    // The customer sees the banner, the weekly schedule, and cannot order.
    await phone.goto(`/r/${shared.slug}`);
    await expect(phone.getByTestId("closed-banner")).toContainText(/Cerrado ahora · Abre (hoy|mañana) a las \d{2}:\d{2}/);
    await expect(phone.getByTestId("pickup-banner")).toHaveCount(0);
    const hours = phone.getByTestId("opening-hours");
    await hours.locator("summary").click();
    await expect(hours.getByTestId("weekly-hours")).toContainText("Domingo");
    await phone.getByTestId("public-product").filter({ hasText: "Barros Luco" }).click();
    const sheet = phone.getByRole("dialog", { name: "Barros Luco" });
    await expect(sheet.getByText("El local no está recibiendo pedidos ahora.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Agregar/ })).toHaveCount(0);
    await phone.keyboard.press("Escape");

    // The owner removes the schedule: only the manual switch decides again.
    await admin.goto(`/admin/${shared.restaurantId}`);
    await expect(useHours).toBeChecked();
    await useHours.click();
    await card.getByRole("button", { name: "Guardar horario" }).click();
    await expect(admin.getByText("Quitaste el horario de atención")).toBeVisible();
    await expect(admin.getByTestId("open-badge")).toHaveText("Recibiendo pedidos");

    // Now the customer orders for pickup.
    await phone.reload();
    await expect(phone.getByTestId("pickup-banner")).toBeVisible();
    await expect(phone.getByTestId("opening-hours")).toHaveCount(0);
    await phone.getByTestId("public-product").filter({ hasText: "Barros Luco" }).click();
    await phone.getByRole("dialog", { name: "Barros Luco" }).getByRole("button", { name: "Agregar $3.500" }).click();
    await phone.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
    const cart = phone.getByRole("dialog", { name: "Tu pedido" });
    await cart.getByLabel("Tu nombre").fill("Tomás");
    await cart.getByLabel("Teléfono").fill("9 8765 4321");
    await cart.getByRole("button", { name: "Pedir para retirar · $3.500" }).click();
    await expect(phone).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);

    // "Ventas" counts it (pending orders count as in progress), unpaid.
    await admin.getByRole("navigation", { name: "Secciones del restaurante" }).getByRole("link", { name: "Ventas" }).click();
    await expect(admin).toHaveURL(new RegExp(`/admin/${shared.restaurantId}/ventas$`));
    await expect(admin.getByTestId("sales-date")).toHaveText("Hoy");
    await expect(admin.getByTestId("kpi-total")).toContainText("$3.500");
    await expect(admin.getByTestId("kpi-orders")).toContainText("1");
    await expect(admin.getByTestId("kpi-unpaid")).toContainText("$3.500");
    await expect(admin.getByTestId("top-products")).toContainText("Barros Luco");
    await expect(admin.getByRole("button", { name: "Día siguiente" })).toBeDisabled();
    await admin.getByRole("button", { name: "Día anterior" }).click();
    await expect(admin.getByTestId("sales-date")).toHaveText("Ayer");
    await expect(admin.getByText("Sin pedidos este día")).toBeVisible();

    // A regular owner has no platform link, and the URL looks like any unknown page.
    await admin.getByRole("button", { name: /Menú de Hilda Dueña/ }).click();
    await expect(admin.getByRole("menuitem", { name: "Cerrar sesión" })).toBeVisible();
    await expect(admin.getByRole("menuitem", { name: "Plataforma" })).toHaveCount(0);
    await admin.keyboard.press("Escape");
    await admin.goto("/plataforma");
    await expect(admin.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
    const apiAnswer = await owner.request.get("/api/platform/restaurants");
    expect(apiAnswer.status()).toBe(404);
  } finally {
    await owner.close();
    await customer.close();
  }
});
