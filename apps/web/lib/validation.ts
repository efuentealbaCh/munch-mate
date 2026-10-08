import { MENU_LIMITS, ORDER_LIMITS, RESTAURANT_ROLES } from "@app/types";
import { normalizePhone, slugProblem } from "@app/utils";
import { z } from "zod";
import { modifierRulesProblem } from "./menu";
import { parsePriceInput } from "./money";
import { SLUG_PROBLEM_MESSAGES } from "./slug-field";
import { BULK_TABLES_MAX, TABLE_LABEL_MAX } from "./tables";

/**
 * Form schemas. Bounds mirror the api DTOs (apps/api/src/modules/{auth,restaurants,menu}/dto) so most mistakes
 * are caught before the request; the api remains the real validation.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const email = z
  .string()
  .trim()
  .min(1, "Ingresa tu correo")
  .max(254, "El correo es demasiado largo")
  .pipe(z.email("Ingresa un correo válido"));

const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Usa al menos ${PASSWORD_MIN} caracteres`)
  .max(PASSWORD_MAX, `Usa como máximo ${PASSWORD_MAX} caracteres`);

const restaurantName = z
  .string()
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres")
  .max(100, "El nombre no puede superar los 100 caracteres");

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const problem = slugProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: SLUG_PROBLEM_MESSAGES[problem] });
  });

const roles = z
  .array(z.enum(RESTAURANT_ROLES))
  .min(1, "Elige al menos un rol")
  .max(RESTAURANT_ROLES.length);

export const loginSchema = z.object({
  email,
  // No minimum on login: the form must not reveal the password policy (same as the api).
  password: z.string().min(1, "Ingresa tu contraseña").max(PASSWORD_MAX),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Ingresa tu nombre").max(100, "El nombre no puede superar los 100 caracteres"),
  email,
  password: newPassword,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((data) => data.password === data.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden" });

export const restaurantSchema = z.object({ name: restaurantName, slug });

export const inviteSchema = z.object({ email, roles });

/** Same pattern as the api (UpdateRestaurantDto.phone); empty clears it. */
export const PHONE_PATTERN = /^$|^\+?[0-9 ()-]{6,20}$/;

export const restaurantProfileSchema = z.object({
  description: z.string().trim().max(300, "La descripción no puede superar los 300 caracteres"),
  phone: z.string().trim().regex(PHONE_PATTERN, "Ingresa un teléfono válido, ej. +56 9 1234 5678"),
});

const menuName = z
  .string()
  .trim()
  .min(1, "Ingresa un nombre")
  .max(MENU_LIMITS.nameMax, `El nombre no puede superar los ${MENU_LIMITS.nameMax} caracteres`);

const menuDescription = z
  .string()
  .trim()
  .max(MENU_LIMITS.descriptionMax, `La descripción no puede superar los ${MENU_LIMITS.descriptionMax} caracteres`);

/** Price typed by the owner ("3.990" or "3990"); converted with parsePriceInput on submit. */
const priceText = (emptyMessage: string) =>
  z.string().superRefine((value, ctx) => {
    if (value.trim() === "") {
      ctx.addIssue({ code: "custom", message: emptyMessage });
      return;
    }
    const amount = parsePriceInput(value);
    if (amount === null) ctx.addIssue({ code: "custom", message: "Usa solo números, ej. 3.990" });
    else if (amount > MENU_LIMITS.priceMax) {
      ctx.addIssue({ code: "custom", message: `El máximo es ${MENU_LIMITS.priceMax.toLocaleString("es-CL")}` });
    }
  });

export const categorySchema = z.object({ name: menuName, description: menuDescription, active: z.boolean() });

export const productSchema = z.object({
  categoryId: z.string().min(1, "Elige una categoría"),
  name: menuName,
  description: menuDescription,
  price: priceText("Ingresa el precio"),
  visible: z.boolean(),
  modifierGroupIds: z
    .array(z.string())
    .max(MENU_LIMITS.groupsPerProductMax, `Un producto puede tener hasta ${MENU_LIMITS.groupsPerProductMax} grupos`),
});

const selectCount = (min: number) =>
  z
    .number({ error: "Ingresa un número" })
    .int("Usa un número entero")
    .min(min, `El mínimo es ${min}`)
    .max(MENU_LIMITS.optionsPerGroupMax, `El máximo es ${MENU_LIMITS.optionsPerGroupMax}`);

export const modifierGroupSchema = z
  .object({
    name: menuName,
    minSelect: selectCount(0),
    maxSelect: selectCount(1),
    options: z
      .array(
        z.object({
          /** Present for options that already exist, so the api keeps their id. */
          optionId: z.string().optional(),
          name: menuName,
          priceDelta: priceText("Ingresa el valor extra (0 si no cuesta más)"),
          available: z.boolean(),
        }),
      )
      .min(1, "Agrega al menos una opción")
      .max(MENU_LIMITS.optionsPerGroupMax, `Un grupo puede tener hasta ${MENU_LIMITS.optionsPerGroupMax} opciones`),
  })
  .superRefine((group, ctx) => {
    if (!Number.isInteger(group.minSelect) || !Number.isInteger(group.maxSelect)) return;
    const problem = modifierRulesProblem(group.minSelect, group.maxSelect, group.options.length);
    if (problem) ctx.addIssue({ code: "custom", path: ["maxSelect"], message: problem });
  });

/** Customer checkout (CreateDineInOrderDto): both fields optional. */
export const checkoutSchema = z.object({
  customerName: z
    .string()
    .trim()
    .max(ORDER_LIMITS.customerNameMax, `El nombre puede tener hasta ${ORDER_LIMITS.customerNameMax} caracteres`),
  note: z.string().trim().max(ORDER_LIMITS.noteMax, `El comentario puede tener hasta ${ORDER_LIMITS.noteMax} caracteres`),
});

/**
 * Pickup checkout (CreatePickupOrderDto): name and phone are required so the restaurant can call; the email
 * is optional (when present, the confirmation with the PDF receipt is sent there). The phone is checked
 * with the same normalizePhone the api uses, so both accept exactly the same formats.
 */
export const pickupCheckoutSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, "Ingresa tu nombre para que te entreguen el pedido")
    .max(ORDER_LIMITS.customerNameMax, `El nombre puede tener hasta ${ORDER_LIMITS.customerNameMax} caracteres`),
  customerPhone: z
    .string()
    .trim()
    .min(1, "Ingresa tu teléfono")
    .max(30, "Revisa el teléfono, ej. +56 9 1234 5678")
    .refine((value) => normalizePhone(value) !== null, "Revisa el teléfono, ej. +56 9 1234 5678"),
  // Blank (or only spaces) means "no email".
  customerEmail: z
    .string()
    .trim()
    .max(ORDER_LIMITS.customerEmailMax, "El correo es demasiado largo")
    .refine((value) => value === "" || z.email().safeParse(value).success, "Ingresa un correo válido o déjalo en blanco"),
  note: z.string().trim().max(ORDER_LIMITS.noteMax, `El comentario puede tener hasta ${ORDER_LIMITS.noteMax} caracteres`),
});

/** Rejecting needs a reason: the customer sees it (ChangeStatusDto.reason). */
export const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Indica el motivo: el cliente lo verá")
    .max(ORDER_LIMITS.rejectReasonMax, `El motivo puede tener hasta ${ORDER_LIMITS.rejectReasonMax} caracteres`),
});

const tableLabel = z
  .string()
  .trim()
  .min(1, "Ingresa un nombre, ej. Mesa 4")
  .max(TABLE_LABEL_MAX, `El nombre puede tener hasta ${TABLE_LABEL_MAX} caracteres`);

/** TableDto / UpdateTableDto. */
export const tableSchema = z.object({ label: tableLabel });

const tableNumber = z
  .number({ error: "Ingresa un número" })
  .int("Usa un número entero")
  .min(0, "Usa números desde 0")
  .max(9999, "Usa números hasta 9999");

/** "Agregar varias": prefix + range (the labels themselves are checked by bulkLabels). */
export const bulkTablesSchema = z
  .object({
    prefix: z.string().trim().max(TABLE_LABEL_MAX - 5, "El prefijo es demasiado largo"),
    from: tableNumber,
    to: tableNumber,
  })
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "Debe ser mayor o igual al número inicial" });
    } else if (value.to - value.from + 1 > BULK_TABLES_MAX) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `Puedes agregar hasta ${BULK_TABLES_MAX} mesas a la vez` });
    }
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
export type RestaurantValues = z.infer<typeof restaurantSchema>;
export type InviteValues = z.infer<typeof inviteSchema>;
export type RestaurantProfileValues = z.infer<typeof restaurantProfileSchema>;
export type CategoryValues = z.infer<typeof categorySchema>;
export type ProductValues = z.infer<typeof productSchema>;
export type ModifierGroupValues = z.infer<typeof modifierGroupSchema>;
export type CheckoutValues = z.infer<typeof checkoutSchema>;
export type PickupCheckoutValues = z.infer<typeof pickupCheckoutSchema>;
export type RejectValues = z.infer<typeof rejectSchema>;
export type TableValues = z.infer<typeof tableSchema>;
export type BulkTablesValues = z.infer<typeof bulkTablesSchema>;
