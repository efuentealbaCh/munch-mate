import { expect, test } from "@playwright/test";
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

test("owner invites a cook, who signs up from the link and joins with the kitchen role", async ({ page, browser }) => {
  const id = runId();
  const ownerEmail = uniqueEmail("owner");
  const cookEmail = uniqueEmail("cook");
  const restaurantName = `Cocinería ${id}`;

  // Owner setup through the api (registration/verification UI is covered by owner-onboarding.spec.ts).
  await registerViaApi(page.request, { name: "Dueña Equipo", email: ownerEmail });
  await verifyEmailViaApi(page.request, ownerEmail);
  const created = await page.request.post("/api/restaurants", { data: { name: restaurantName }, headers: ORIGIN_HEADER });
  expect(created.status(), await created.text()).toBe(201);
  const { id: restaurantId } = (await created.json()) as { id: string };

  // Owner invites the cook from the team page.
  await page.goto(`/admin/${restaurantId}`);
  await page.getByRole("navigation", { name: "Secciones del restaurante" }).getByRole("link", { name: "Equipo" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${restaurantId}/equipo$`));
  const inviteForm = page.getByRole("form", { name: "Invitar a alguien" });
  await inviteForm.getByLabel("Correo").fill(cookEmail);
  // No role chosen yet: client-side validation.
  await inviteForm.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(inviteForm.getByText("Elige al menos un rol")).toBeVisible();
  await inviteForm.getByRole("checkbox", { name: "Cocina" }).check();
  await inviteForm.getByRole("button", { name: "Enviar invitación" }).click();
  const pending = page.getByRole("list", { name: "Invitaciones pendientes" });
  await expect(pending.getByText(cookEmail)).toBeVisible();
  await expect(pending).toContainText("Invitado por Dueña Equipo");

  // The cook opens the emailed link in a fresh browser.
  const invitationLink = await waitForEmailLink(cookEmail, "/invitacion");
  const cookContext = await browser.newContext(CONTEXT_OPTIONS);
  const cook = await cookContext.newPage();
  try {
    await cook.goto(invitationLink);
    await expect(cook.getByRole("heading", { name: `Te invitaron a ${restaurantName}` })).toBeVisible();
    await expect(cook.getByText("Cocina", { exact: true })).toBeVisible();
    await cook.getByRole("link", { name: "Crear cuenta" }).click();

    // Registration is prefilled with the invited email and returns to the invitation.
    await expect(cook).toHaveURL(/\/registro\?/);
    await expect(cook.getByLabel("Correo")).toHaveValue(cookEmail);
    await cook.getByLabel("Nombre").fill("Carlos Cocinero");
    await cook.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await cook.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(cook).toHaveURL(/\/invitacion\?token=/);
    await cook.getByRole("button", { name: "Aceptar invitación" }).click();

    // Lands on the restaurant as a cook, without owner tools.
    await expect(cook).toHaveURL(new RegExp(`/admin/${restaurantId}$`));
    await expect(cook.getByRole("heading", { level: 1, name: restaurantName })).toBeVisible();
    await expect(cook.getByRole("list", { name: "Roles" })).toHaveText("Cocina");
    const tabs = cook.getByRole("navigation", { name: "Secciones del restaurante" });
    await expect(tabs.getByRole("link", { name: "Resumen" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Equipo" })).toHaveCount(0);
    await expect(cook.getByRole("heading", { name: "Configuración" })).toHaveCount(0);
    // Accepting the invitation verified the email.
    await expect(cook.getByRole("region", { name: "Correo sin confirmar" })).toHaveCount(0);

    await cook.goto(`/admin/${restaurantId}/equipo`);
    await expect(cook.getByRole("heading", { name: "Solo para dueños" })).toBeVisible();
    await expect(cook.getByRole("form", { name: "Invitar a alguien" })).toHaveCount(0);
  } finally {
    await cookContext.close();
  }

  // The owner now sees the cook as a member and no pending invitation.
  await page.reload();
  const cookRow = page.getByTestId("member-row").filter({ hasText: cookEmail });
  await expect(cookRow).toBeVisible();
  await expect(cookRow.getByRole("checkbox", { name: "Cocina" })).toBeChecked();
  await expect(page.getByText("No hay invitaciones pendientes.")).toBeVisible();
});
