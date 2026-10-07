import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  CONTEXT_OPTIONS,
  ORIGIN_HEADER,
  PASSWORD,
  registerViaApi,
  runId,
  uniqueEmail,
  verifyEmailViaApi,
  waitForEmailLink,
} from "./helpers";

/*
 * Phase 2: an owner builds the menu, the public menu shows it, and kitchen staff mark a product as sold out.
 * The "zz-" prefix makes this file run last (files run in name order): it registers 2 users, and when the
 * suite reaches the 5/min registration limit, registerViaApi waits for the window here instead of making
 * a UI registration in another spec fail. The two tests share one restaurant and run in order.
 */
test.describe.configure({ mode: "serial", timeout: 180_000 });

const id = runId();
const ownerEmail = uniqueEmail("menu-owner");
const cookEmail = uniqueEmail("menu-cook");
const restaurantName = `Sanguchería ${id}`;
let restaurantId = "";
let slug = "";

/** A 480×360 JPEG drawn on a canvas in the page (no image files or native tools needed). */
async function makeJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 360;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    const gradient = context.createLinearGradient(0, 0, 480, 360);
    gradient.addColorStop(0, "#c2410c");
    gradient.addColorStop(1, "#fde68a");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 480, 360);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9),
    );
    let binary = "";
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

/** Opens the public menu in a fresh, anonymous browser context. */
async function openPublicMenu(browser: Browser) {
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();
  await page.goto(`/r/${slug}`);
  return { context, page };
}

test("owner builds a menu with a modifier group and a photo, and customers see it at /r/<slug>", async ({ page, browser }) => {
  await registerViaApi(page.request, { name: "Dueña Menú", email: ownerEmail });
  await verifyEmailViaApi(page.request, ownerEmail);
  const created = await page.request.post("/api/restaurants", { data: { name: restaurantName }, headers: ORIGIN_HEADER });
  expect(created.status(), await created.text()).toBe(201);
  ({ id: restaurantId, slug } = (await created.json()) as { id: string; slug: string });

  // Empty menu teaches the first step.
  await page.goto(`/admin/${restaurantId}`);
  await page.getByRole("navigation", { name: "Secciones del restaurante" }).getByRole("link", { name: "Menú" }).click();
  await expect(page.getByRole("heading", { name: "Tu menú está vacío" })).toBeVisible();
  await page.getByRole("button", { name: "Crear categoría" }).click();
  const categoryDialog = page.getByRole("dialog", { name: "Nueva categoría" });
  await categoryDialog.getByLabel("Nombre").fill("Sándwiches");
  await categoryDialog.getByRole("button", { name: "Crear categoría" }).click();
  await expect(categoryDialog).toHaveCount(0);
  const section = page.getByRole("region", { name: "Sándwiches" });
  await expect(section.getByRole("button", { name: "Agrega un producto" })).toBeVisible();

  // Modifier library: "Tamaño", required, 2 options.
  await page.getByRole("navigation", { name: "Secciones del menú" }).getByRole("link", { name: "Modificadores" }).click();
  await page.getByRole("button", { name: "Crear grupo" }).click();
  const groupSheet = page.getByRole("dialog", { name: "Nuevo grupo de opciones" });
  await groupSheet.getByLabel("Nombre", { exact: true }).fill("Tamaño");
  await groupSheet.getByLabel("Opción 1", { exact: true }).fill("Normal");
  await groupSheet.getByLabel("Opción 2", { exact: true }).fill("Grande");
  await groupSheet.getByLabel("Valor extra").nth(1).fill("800");
  // Client-side mirror of the api rules: max cannot exceed the number of options.
  await groupSheet.getByLabel("Máximo").fill("3");
  await groupSheet.getByRole("button", { name: "Crear grupo" }).click();
  await expect(groupSheet.getByText("El máximo (3) no puede superar la cantidad de opciones (2)")).toBeVisible();
  await groupSheet.getByLabel("Máximo").fill("1");
  await expect(groupSheet.getByText("Obligatorio · elige 1")).toBeVisible();
  await groupSheet.getByRole("button", { name: "Crear grupo" }).click();
  await expect(groupSheet).toHaveCount(0);
  const groupCard = page.getByTestId("modifier-group").filter({ hasText: "Tamaño" });
  await expect(groupCard).toContainText("Obligatorio · elige 1");
  await expect(groupCard).toContainText("+$800");
  await expect(groupCard).toContainText("No se usa en ningún producto");

  // Product with that group, then its photo.
  await page.getByRole("navigation", { name: "Secciones del menú" }).getByRole("link", { name: "Productos" }).click();
  await section.getByRole("button", { name: "Agrega un producto" }).click();
  const productSheet = page.getByRole("dialog", { name: "Nuevo producto" });
  await expect(productSheet.getByLabel("Categoría")).toHaveValue(/.+/);
  await productSheet.getByLabel("Nombre").fill("Barros Luco");
  await productSheet.getByLabel("Descripción (opcional)").fill("Carne y queso derretido en pan frica");
  await productSheet.getByLabel("Precio").fill("3990");
  await productSheet.getByLabel("Grupo para agregar").selectOption({ label: "Tamaño (Obligatorio · elige 1)" });
  await productSheet.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(productSheet.getByRole("list", { name: "Grupos elegidos" })).toContainText("Tamaño");
  await productSheet.getByRole("button", { name: "Crear producto" }).click();

  const editSheet = page.getByRole("dialog", { name: "Editar producto" });
  await expect(editSheet.getByRole("button", { name: "Subir imagen" })).toBeVisible();
  await editSheet.getByTestId("image-input").setInputFiles({
    name: "barros-luco.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page),
  });
  await expect(editSheet.getByRole("button", { name: "Cambiar imagen" })).toBeVisible({ timeout: 20_000 });
  await expect(editSheet.getByRole("img", { name: "Imagen actual" })).toHaveAttribute("src", /\.webp$/);
  await editSheet.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  await expect(editSheet).toHaveCount(0);

  const row = section.getByTestId("product-row").filter({ hasText: "Barros Luco" });
  await expect(row).toContainText("$3.990");
  await expect(row.locator("img")).toHaveAttribute("src", /\.webp$/);

  // Anonymous customer.
  const visitor = await openPublicMenu(browser);
  try {
    const menu = visitor.page;
    await expect(menu).toHaveTitle(restaurantName);
    await expect(menu.getByRole("heading", { level: 1, name: restaurantName })).toBeVisible();
    await expect(menu.getByRole("navigation", { name: "Categorías del menú" }).getByRole("link", { name: "Sándwiches" })).toBeVisible();
    const card = menu.getByTestId("public-product").filter({ hasText: "Barros Luco" });
    await expect(card).toContainText("$3.990");
    const photo = card.getByTestId("product-photo");
    await photo.scrollIntoViewIfNeeded();
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

    await card.click();
    const detail = menu.getByRole("dialog", { name: "Barros Luco" });
    await expect(detail.getByRole("heading", { name: "Tamaño" })).toBeVisible();
    await expect(detail).toContainText("Obligatorio · elige 1");
    await expect(detail).toContainText("Grande");
    await expect(detail).toContainText("+$800");
    await expect(detail).toContainText("Para pedir, escanea el código QR de tu mesa");
  } finally {
    await visitor.context.close();
  }

  // Unknown slugs get the friendly 404.
  const missing = await page.goto(`/r/no-existe-${id}`);
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "No encontramos este menú" })).toBeVisible();
});

test("kitchen staff mark a product as sold out, cannot edit the menu, and customers see «Agotado»", async ({ browser }) => {
  expect(restaurantId, "the previous test creates the restaurant").not.toBe("");

  // Owner invites the cook (team UI is covered by team-invitation.spec.ts).
  const ownerContext = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const login = await ownerContext.request.post("/api/auth/login", {
      data: { email: ownerEmail, password: PASSWORD },
      headers: ORIGIN_HEADER,
    });
    expect(login.status(), await login.text()).toBe(200);
    const invite = await ownerContext.request.post(`/api/restaurants/${restaurantId}/invitations`, {
      data: { email: cookEmail, roles: ["kitchen"] },
      headers: ORIGIN_HEADER,
    });
    expect(invite.status(), await invite.text()).toBe(201);
  } finally {
    await ownerContext.close();
  }

  const cookContext = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const cook = await cookContext.newPage();
    await registerViaApi(cookContext.request, { name: "Carla Cocina", email: cookEmail });
    await cook.goto(await waitForEmailLink(cookEmail, "/invitacion"));
    await cook.getByRole("button", { name: "Aceptar invitación" }).click();
    await expect(cook).toHaveURL(new RegExp(`/admin/${restaurantId}$`));

    const tabs = cook.getByRole("navigation", { name: "Secciones del restaurante" });
    await expect(tabs.getByRole("link", { name: "Menú" })).toHaveCount(0);
    await tabs.getByRole("link", { name: "Disponibilidad" }).click();

    const product = cook.getByRole("switch", { name: "Barros Luco disponible" });
    await expect(product).toBeChecked();
    await product.click();
    await expect(product).not.toBeChecked();
    await expect(cook.getByTestId("availability-row").filter({ hasText: "Barros Luco" })).toContainText("Agotado");
    const option = cook.getByRole("switch", { name: "Grande (Tamaño) disponible" });
    await option.click();
    await expect(option).not.toBeChecked();

    // Survives a reload (it was saved, not only shown).
    await cook.reload();
    await expect(cook.getByRole("switch", { name: "Barros Luco disponible" })).not.toBeChecked();

    // The editor stays owner-only, even by URL.
    await cook.goto(`/admin/${restaurantId}/menu`);
    await expect(cook.getByRole("heading", { name: "Solo para dueños" })).toBeVisible();
    await expect(cook.getByRole("button", { name: "Nueva categoría" })).toHaveCount(0);
  } finally {
    await cookContext.close();
  }

  const visitor = await openPublicMenu(browser);
  try {
    const card = visitor.page.getByTestId("public-product").filter({ hasText: "Barros Luco" });
    await expect(card).toContainText("Agotado");
    await card.click();
    const detail = visitor.page.getByRole("dialog", { name: "Barros Luco" });
    await expect(detail.getByRole("listitem").filter({ hasText: "Grande" })).toContainText("Agotado");
  } finally {
    await visitor.context.close();
  }
});
