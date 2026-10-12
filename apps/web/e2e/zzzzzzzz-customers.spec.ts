import { type APIRequestContext, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { CONTEXT_OPTIONS, ORIGIN_HEADER, PASSWORD, registerViaApi, runId, uniqueEmail, verifyEmailViaApi } from "./helpers";

/*
 * Phase 6: customer accounts and the web push UI. Runs last (file order) and registers 2 users (owner and
 * customer); registerViaApi waits out the 5/min registration limit when the earlier specs used it up.
 * - A customer with an account fills "Mi cuenta" (phone, a saved address), orders from the public menu with
 *   the data prefilled, finds the order in "Mis pedidos", and the delivery checkout offers the saved address.
 * - Push: real notifications cannot be tested in Playwright (no push service). Only the UI is checked: every
 *   push button is hidden when the server has no VAPID key (`push-config.publicKey` null, mocked here so the
 *   result does not depend on the stack's .env), and "Avísame" shows up when there is one.
 */
test.describe.configure({ mode: "serial", timeout: 300_000 });

const id = runId();
const ownerEmail = uniqueEmail("customers-owner");
const customerEmail = uniqueEmail("customers-customer");
const restaurantName = `Clientes ${id}`;
const CUSTOMER_NAME = "Carla Cliente";

/** Filled by the tests. */
const shared = { restaurantId: "", slug: "", pickupTracking: "" };

async function send(api: APIRequestContext, method: "get" | "post" | "patch" | "put", path: string, data?: unknown, status = 200) {
  const response = await api[method](path, method === "get" ? {} : { data, headers: ORIGIN_HEADER });
  expect(response.status(), await response.text()).toBe(status);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as Record<string, unknown>;
}

/** Owner, open restaurant with pickup and delivery on, one product of $4.500 and one zone by name. */
async function setup(owner: BrowserContext): Promise<void> {
  const api = owner.request;
  await registerViaApi(api, { name: "Olivia Dueña", email: ownerEmail });
  await verifyEmailViaApi(api, ownerEmail);
  const restaurant = await send(api, "post", "/api/restaurants", { name: restaurantName }, 201);
  shared.restaurantId = String(restaurant.id);
  shared.slug = String(restaurant.slug);
  const base = `/api/restaurants/${shared.restaurantId}`;
  await send(api, "patch", base, { phone: "+56 2 2345 6789", pickupEnabled: true, deliveryEnabled: true });
  await send(api, "put", `${base}/accepting-orders`, { acceptingOrders: true });
  const category = await send(api, "post", `${base}/menu/categories`, { name: "Sándwiches", description: "" }, 201);
  await send(
    api,
    "post",
    `${base}/menu/products`,
    { categoryId: category.id, name: "Barros Luco", description: "", price: 4500, visible: true, modifierGroupIds: [] },
    201,
  );
  await send(api, "post", `${base}/delivery-zones`, { name: "Centro", fee: 0, minOrder: 0, isHome: true }, 201);
}

/** One Barros Luco in the cart and "Tu pedido" open. */
async function openCheckout(page: Page) {
  await page.goto(`/r/${shared.slug}`);
  await page.getByTestId("public-product").filter({ hasText: "Barros Luco" }).click();
  await page.getByRole("dialog", { name: "Barros Luco" }).getByRole("button", { name: "Agregar $4.500" }).click();
  await page.getByRole("button", { name: /Ver pedido \(1\)/ }).click();
  return page.getByRole("dialog", { name: "Tu pedido" });
}

test("a customer with an account: Mi cuenta, prefilled checkout, Mis pedidos and saved addresses", async ({ browser }) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  const customer = await browser.newContext(CONTEXT_OPTIONS);
  try {
    await setup(owner);
    // Customers need no verified email to order.
    await registerViaApi(customer.request, { name: CUSTOMER_NAME, email: customerEmail });
    const phone = await customer.newPage();

    // Mi cuenta: the phone the checkout will use.
    await phone.goto("/mi-cuenta");
    await expect(phone.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
    await expect(phone.getByLabel("Nombre", { exact: true })).toHaveValue(CUSTOMER_NAME);
    await phone.getByLabel("Teléfono (opcional)").fill("9 1234 5678");
    await phone.getByRole("button", { name: "Guardar datos" }).click();
    await expect(phone.getByText("Guardamos tus datos")).toBeVisible();

    // A saved address (no pin: the zone is chosen by name at checkout).
    await phone.getByRole("button", { name: "Agregar dirección" }).click();
    const dialog = phone.getByRole("dialog", { name: "Nueva dirección" });
    await expect(dialog.getByLabel("Nombre")).toHaveValue("Casa");
    await dialog.getByLabel("Calle y número").fill("Av. Italia 1234");
    await dialog.getByLabel("Depto, casa u oficina (opcional)").fill("Depto 402");
    await dialog.getByLabel("Referencia (opcional)").fill("Portón verde");
    await dialog.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(dialog).toHaveCount(0);
    const addresses = phone.getByTestId("saved-addresses");
    await expect(addresses).toContainText("Casa");
    await expect(addresses).toContainText("Av. Italia 1234, Depto 402");

    // Pickup from the public menu: name and phone come from the account.
    let cart = await openCheckout(phone);
    await expect(cart.getByRole("radio", { name: "Retiro en local" })).toHaveAttribute("aria-checked", "true");
    await expect(cart.getByTestId("checkout-account")).toBeVisible();
    await expect(cart.getByLabel("Tu nombre")).toHaveValue(CUSTOMER_NAME);
    await expect(cart.getByLabel("Teléfono")).toHaveValue("+569 12345678");
    await cart.getByRole("button", { name: /Pedir para retirar/ }).click();
    await expect(phone).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);
    await expect(phone.getByTestId("order-status")).toHaveText("Pendiente");
    shared.pickupTracking = new URL(phone.url()).hash;

    // Mis pedidos: the order is linked to the account and opens its tracking page.
    await phone.goto("/mis-pedidos");
    const row = phone.getByTestId("customer-orders").getByRole("link").filter({ hasText: restaurantName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Para retirar");
    await expect(row.getByTestId("customer-order-status")).toHaveText("Pendiente");
    await expect(row).toContainText("$4.500");
    await row.click();
    // The token is base64url: safe inside a RegExp.
    await expect(phone).toHaveURL(new RegExp(`/pedido${shared.pickupTracking}$`));

    // Delivery: "Mis direcciones" fills the address; it is already saved, so no "Guardar esta dirección".
    cart = await openCheckout(phone);
    await cart.getByRole("radio", { name: "Delivery" }).click();
    const select = cart.getByTestId("saved-address-select");
    await expect(select).toBeVisible();
    await select.selectOption({ label: "Casa · Av. Italia 1234, Depto 402" });
    await expect(cart.getByLabel("Calle y número")).toHaveValue("Av. Italia 1234");
    await expect(cart.getByLabel("Depto, casa u oficina (opcional)")).toHaveValue("Depto 402");
    await expect(cart.getByLabel("Referencia (opcional)")).toHaveValue("Portón verde");
    await expect(cart.getByLabel("Guardar esta dirección en mi cuenta")).toHaveCount(0);
    // A new address offers saving it.
    await cart.getByLabel("Calle y número").fill("Los Leones 50");
    await expect(cart.getByLabel("Guardar esta dirección en mi cuenta")).toBeVisible();
    await select.selectOption({ label: "Casa · Av. Italia 1234, Depto 402" });
    await cart.getByRole("radio", { name: "Efectivo" }).check();
    await cart.getByRole("button", { name: /Pedir delivery/ }).click();
    await expect(phone).toHaveURL(/\/pedido#t=[A-Za-z0-9_-]{20,}$/);
    await expect(phone.getByTestId("delivery-address")).toContainText("Av. Italia 1234, Depto 402");

    await phone.goto("/mis-pedidos");
    await expect(phone.getByTestId("customer-orders").getByRole("link").filter({ hasText: restaurantName })).toHaveCount(2);
  } finally {
    await owner.close();
    await customer.close();
  }
});

test("guests get a login link back to the menu; push buttons hide without a server key", async ({ browser }) => {
  const guest = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const page = await guest.newPage();
    const cart = await openCheckout(page);
    const login = cart.getByTestId("checkout-login").getByRole("link", { name: "Ingresa para usar tus datos" });
    await expect(login).toHaveAttribute("href", `/ingresar?next=${encodeURIComponent(`/r/${shared.slug}`)}`);

    // Push off on the server: no "Avísame" on a pending pickup order (the tracking link works for anyone).
    await page.route("**/api/public/push-config", (route) => route.fulfill({ json: { publicKey: null } }));
    await page.goto(`/pedido${shared.pickupTracking}`);
    await expect(page.getByTestId("order-status")).toBeVisible();
    await expect(page.getByTestId("push-follow")).toHaveCount(0);

    // With a key (fake: nothing is subscribed here) the button is offered. Assumes Chromium exposes
    // PushManager to the emulated Android phone, as desktop Chromium does.
    await page.unroute("**/api/public/push-config");
    await page.route("**/api/public/push-config", (route) => route.fulfill({ json: { publicKey: `BA${"A".repeat(85)}` } }));
    await page.reload();
    await expect(page.getByTestId("push-follow")).toHaveText("Avísame cuando esté listo");
  } finally {
    await guest.close();
  }
});

test("the board hides the device switch without a server key", async ({ browser }) => {
  const owner = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const login = await owner.request.post("/api/auth/login", {
      data: { email: ownerEmail, password: PASSWORD },
      headers: ORIGIN_HEADER,
    });
    expect(login.status(), await login.text()).toBe(200);
    const board = await owner.newPage();
    await board.route("**/api/public/push-config", (route) => route.fulfill({ json: { publicKey: null } }));
    await board.goto(`/admin/${shared.restaurantId}/pedidos`);
    await expect(board.getByRole("button", { name: /Activar sonido|Sonido activado/ })).toBeVisible();
    await expect(board.getByTestId("push-device-button")).toHaveCount(0);
  } finally {
    await owner.close();
  }
});
