import { expect, type Page, test } from "@playwright/test";
import { PASSWORD, apiContext, registerViaApi, uniqueEmail, waitForEmailLink, waitForHydration } from "./helpers";

// One user for the whole file (registration is rate-limited); the tests run in order.
test.describe.configure({ mode: "serial" });

const email = uniqueEmail("account");
const NEW_PASSWORD = "otra-contraseña-456";

test.beforeAll(async () => {
  const api = await apiContext();
  try {
    await registerViaApi(api, { name: "Berta Cuenta", email });
  } finally {
    await api.dispose();
  }
});

async function login(page: Page, password: string) {
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

test("protected pages send anonymous visitors to login and back; logout ends the session", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/ingresar\?next=%2Fadmin$/);
  await waitForHydration(page);

  await login(page, PASSWORD);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Mis restaurantes" })).toBeVisible();

  await page.getByRole("button", { name: "Menú de Berta Cuenta" }).click();
  await expect(page.getByRole("menu")).toContainText(email);
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/ingresar$/);

  // The session is really gone (not just hidden in the UI).
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/ingresar\?next=%2Fadmin$/);
  await login(page, PASSWORD);
  await expect(page.getByRole("heading", { name: "Mis restaurantes" })).toBeVisible();
});

test("forgot password: emailed link, new password, old one stops working", async ({ page }) => {
  await page.goto("/ingresar");
  // Clicked before hydration, the link is a full page load and the email could be typed into server HTML.
  await waitForHydration(page);
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "Recuperar contraseña" })).toBeVisible();
  await waitForHydration(page);
  await page.getByLabel("Correo").fill(email);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();
  await expect(page.getByText(/Si existe una cuenta con/)).toBeVisible();

  await page.goto(await waitForEmailLink(email, "/restablecer-contrasena"));
  await waitForHydration(page);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Repite la contraseña", { exact: true }).fill("no-coincide-000");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("Las contraseñas no coinciden")).toBeVisible();
  await page.getByLabel("Repite la contraseña", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();

  await expect(page).toHaveURL(/\/ingresar\?reset=1$/);
  await expect(page.getByText(/Tu contraseña se actualizó/)).toBeVisible();

  await login(page, PASSWORD);
  await expect(page.getByText("Correo o contraseña incorrectos")).toBeVisible();
  await login(page, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Mis restaurantes" })).toBeVisible();
});
