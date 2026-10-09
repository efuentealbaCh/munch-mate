import { expect, test } from "@playwright/test";
import { ORIGIN_HEADER, PASSWORD, runId, uniqueEmail, waitForEmailLink } from "./helpers";

test("owner registers, verifies the email and creates a restaurant", async ({ page }) => {
  const id = runId();
  const email = uniqueEmail("owner");

  // Register from the landing page.
  await page.goto("/");
  await page.getByRole("link", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/registro$/);
  await page.getByLabel("Nombre").fill("Ana Pérez");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  // Lands on the panel, unverified.
  await expect(page).toHaveURL(/\/admin$/);
  const banner = page.getByRole("region", { name: "Correo sin confirmar" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(email);
  await expect(page.getByText("Aún no tienes restaurantes")).toBeVisible();

  // Follow the emailed verification link.
  await page.goto(await waitForEmailLink(email, "/verificar-email"));
  await expect(page.getByRole("heading", { name: "Correo confirmado" })).toBeVisible();
  await page.getByRole("link", { name: "Ir al panel" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Mis restaurantes" })).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Another restaurant owns this slug, to exercise the "taken" state.
  const takenSlug = `e2e-tomado-${id}`;
  const taken = await page.request.post("/api/restaurants", {
    data: { name: "Restaurante tomado", slug: takenSlug },
    headers: ORIGIN_HEADER,
  });
  expect(taken.status(), await taken.text()).toBe(201);

  await page.goto("/admin/nuevo");
  const name = `La Picá de Ñuñoa ${id}`;
  const slugInput = page.getByLabel("Dirección web");
  await page.getByLabel("Nombre del restaurante").fill(name);
  // Generated from the accented name.
  await expect(slugInput).toHaveValue(`la-pica-de-nunoa-${id}`);
  await expect(page.getByText("Disponible", { exact: true })).toBeVisible();

  // Invalid locally (no request needed).
  await slugInput.fill("admin");
  await expect(page.getByText("Esa dirección está reservada, elige otra")).toBeVisible();
  await slugInput.fill("con espacios");
  await expect(page.getByText(/Usa solo minúsculas, números y guiones/)).toBeVisible();

  // Taken, with a suggestion from the api.
  await slugInput.fill(takenSlug);
  await expect(page.getByText("En uso por otro restaurante.")).toBeVisible();
  const useSuggestion = page.getByRole("button", { name: /^Usar / });
  const suggestion = ((await useSuggestion.textContent()) ?? "").replace(/^Usar /, "").trim();
  expect(suggestion).toMatch(new RegExp(`^${takenSlug}-\\d+$`));
  await useSuggestion.click();
  await expect(slugInput).toHaveValue(suggestion);
  await expect(page.getByText("Disponible", { exact: true })).toBeVisible();

  // Create and land on the overview.
  await page.getByRole("button", { name: "Crear restaurante" }).click();
  await expect(page).toHaveURL(/\/admin\/[0-9a-f]{24}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByTestId("public-url")).toHaveText(`localhost/r/${suggestion}`);
  await expect(page.getByRole("navigation", { name: "Secciones del restaurante" }).getByRole("link", { name: "Equipo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();

  // The new restaurant is listed with the owner badge.
  await page.getByRole("link", { name: "Mis restaurantes" }).click();
  const card = page.getByRole("link", { name: new RegExp(name) });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Dueño");
});
