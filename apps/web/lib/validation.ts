import {
  DELIVERY_ZONE_LIMITS,
  MENU_LIMITS,
  ORDER_LIMITS,
  PAYMENT_METHODS,
  type PublicDeliveryZone,
  RESTAURANT_ROLES,
} from "@app/types";
import { normalizePhone, PHONE_EXAMPLE, slugProblem } from "@app/utils";
import { z } from "zod";
import { cleanLine, cleanText } from "./clean-text";
import { modifierRulesProblem } from "./menu";
import { formatPrice, parsePriceInput } from "./money";
import { SLUG_PROBLEM_MESSAGES } from "./slug-field";
import { BULK_TABLES_MAX, TABLE_LABEL_MAX } from "./tables";

/**
 * Form schemas. Bounds mirror the api DTOs (apps/api/src/modules/{auth,restaurants,menu}/dto) so most mistakes
 * are caught before the request; the api remains the real validation. Free text goes through the same
 * clean-up as the api (cleanLine / cleanText) before it is measured, so a field of blanks or invisible
 * characters is empty here too and the maximums count the text the api will store.
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
  .overwrite(cleanLine)
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
  name: z.string().overwrite(cleanLine).min(1, "Ingresa tu nombre").max(100, "El nombre no puede superar los 100 caracteres"),
  email,
  password: newPassword,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((data) => data.password === data.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden" });

export const restaurantSchema = z.object({ name: restaurantName, slug });

export const inviteSchema = z.object({ email, roles });

export const PHONE_ERROR = `Revisa el teléfono, ej. ${PHONE_EXAMPLE}`;

/** Checked with the same normalizePhone the api uses (customers and restaurants), so both accept the same formats. */
const phone = z
  .string()
  .overwrite(cleanLine)
  .max(30, PHONE_ERROR)
  .refine((value) => normalizePhone(value) !== null, PHONE_ERROR);

export const restaurantProfileSchema = z.object({
  description: z.string().overwrite(cleanText).max(300, "La descripción no puede superar los 300 caracteres"),
  // Empty clears it.
  phone: z
    .string()
    .overwrite(cleanLine)
    .max(30, PHONE_ERROR)
    .refine((value) => value === "" || normalizePhone(value) !== null, PHONE_ERROR),
});

/** Owner setting `maxItemsPerOrder` (UpdateRestaurantDto): units (sum of quantities) allowed in one order. */
export const itemsLimitSchema = z.object({
  maxItemsPerOrder: z
    .number({ error: "Ingresa un número" })
    .int("Usa un número entero")
    .min(ORDER_LIMITS.itemsPerOrderMin, `El mínimo es ${ORDER_LIMITS.itemsPerOrderMin} producto por pedido`)
    .max(ORDER_LIMITS.itemsPerOrderMax, `El máximo es ${ORDER_LIMITS.itemsPerOrderMax} productos por pedido`),
});

const menuName = z
  .string()
  .overwrite(cleanLine)
  .min(1, "Ingresa un nombre")
  .max(MENU_LIMITS.nameMax, `El nombre no puede superar los ${MENU_LIMITS.nameMax} caracteres`);

const menuDescription = z
  .string()
  .overwrite(cleanText)
  .max(MENU_LIMITS.descriptionMax, `La descripción no puede superar los ${MENU_LIMITS.descriptionMax} caracteres`);

/**
 * Price typed by the owner ("3.990" or "3990"); converted with parsePriceInput on submit.
 * @param max Upper bound of the matching api DTO (menu prices by default).
 */
const priceText = (emptyMessage: string, max: number = MENU_LIMITS.priceMax) =>
  z.string().superRefine((value, ctx) => {
    if (value.trim() === "") {
      ctx.addIssue({ code: "custom", message: emptyMessage });
      return;
    }
    const amount = parsePriceInput(value);
    if (amount === null) ctx.addIssue({ code: "custom", message: "Usa solo números, ej. 3.990" });
    else if (amount > max) {
      ctx.addIssue({ code: "custom", message: `El máximo es ${max.toLocaleString("es-CL")}` });
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
    .overwrite(cleanLine)
    .max(ORDER_LIMITS.customerNameMax, `El nombre puede tener hasta ${ORDER_LIMITS.customerNameMax} caracteres`),
  note: z.string().overwrite(cleanText).max(ORDER_LIMITS.noteMax, `El comentario puede tener hasta ${ORDER_LIMITS.noteMax} caracteres`),
});

/**
 * Pickup checkout (CreatePickupOrderDto): name and phone are required so the restaurant can call; the email
 * is optional (when present, the confirmation with the PDF receipt is sent there). The phone is checked
 * with the same normalizePhone the api uses, so both accept exactly the same formats.
 */
export const pickupCheckoutSchema = z.object({
  customerName: z
    .string()
    .overwrite(cleanLine)
    .min(2, "Ingresa tu nombre para que te entreguen el pedido")
    .max(ORDER_LIMITS.customerNameMax, `El nombre puede tener hasta ${ORDER_LIMITS.customerNameMax} caracteres`),
  customerPhone: z.string().overwrite(cleanLine).min(1, "Ingresa tu teléfono").pipe(phone),
  // Blank (or only spaces) means "no email".
  customerEmail: z
    .string()
    .trim()
    .max(ORDER_LIMITS.customerEmailMax, "El correo es demasiado largo")
    .refine((value) => value === "" || z.email().safeParse(value).success, "Ingresa un correo válido o déjalo en blanco"),
  note: z.string().overwrite(cleanText).max(ORDER_LIMITS.noteMax, `El comentario puede tener hasta ${ORDER_LIMITS.noteMax} caracteres`),
});

/** Same bound as ExpectedPaymentDto.cashAmount. */
export const CASH_AMOUNT_MAX = 100_000_000;

/** What the delivery checkout needs to check amounts: the cart subtotal and the zones offered. */
export interface DeliveryCheckoutContext {
  subtotal: number;
  zones: readonly PublicDeliveryZone[];
  currency: string;
}

/**
 * Delivery checkout (CreateDeliveryOrderDto): the pickup contact fields plus the zone, the address and how
 * the customer will pay. Built per cart because two rules depend on amounts: the zone's minimum (subtotal,
 * without the fee) and the cash amount, which must cover subtotal + fee. The api checks both again
 * (BELOW_MINIMUM_ORDER, CASH_AMOUNT_TOO_LOW).
 */
export function deliveryCheckoutSchema({ subtotal, zones, currency }: DeliveryCheckoutContext) {
  return pickupCheckoutSchema
    .extend({
      zoneId: z.string().min(1, "Elige tu comuna o zona"),
      address: z
        .string()
        .overwrite(cleanLine)
        .min(3, "Indica la calle y el número")
        .max(ORDER_LIMITS.addressMax, `La dirección puede tener hasta ${ORDER_LIMITS.addressMax} caracteres`),
      unit: z.string().overwrite(cleanLine).max(ORDER_LIMITS.addressUnitMax, `Usa hasta ${ORDER_LIMITS.addressUnitMax} caracteres`),
      reference: z
        .string()
        .overwrite(cleanText)
        .max(ORDER_LIMITS.addressReferenceMax, `La referencia puede tener hasta ${ORDER_LIMITS.addressReferenceMax} caracteres`),
      // Boolean(): a `value !== ""` arrow would be inferred as a type guard and drop "" from the form values.
      paymentMethod: z.union([z.enum(PAYMENT_METHODS), z.literal("")]).refine((value) => Boolean(value), "Elige cómo vas a pagar"),
      // Free text ("20.000"); blank = the customer did not say (the rider brings change anyway).
      cashAmount: z.string(),
    })
    .superRefine((values, ctx) => {
      const zone = zones.find((z) => z.id === values.zoneId);
      if (values.zoneId && !zone) {
        ctx.addIssue({ code: "custom", path: ["zoneId"], message: "Esta zona ya no está disponible. Elige otra." });
        return;
      }
      if (!zone) return;
      if (subtotal < zone.minOrder) {
        ctx.addIssue({
          code: "custom",
          path: ["zoneId"],
          message: `El pedido mínimo para ${zone.name} es ${formatPrice(zone.minOrder, currency)} (sin el envío)`,
        });
      }
      if (values.paymentMethod !== "cash" || values.cashAmount.trim() === "") return;
      const amount = parsePriceInput(values.cashAmount);
      const total = subtotal + zone.fee;
      if (amount === null || amount > CASH_AMOUNT_MAX) {
        ctx.addIssue({ code: "custom", path: ["cashAmount"], message: "Usa solo números, ej. 20.000" });
      } else if (amount < total) {
        ctx.addIssue({ code: "custom", path: ["cashAmount"], message: `Debe cubrir el total (${formatPrice(total, currency)})` });
      }
    });
}

/** Owner's delivery zone (DeliveryZoneDto). Amounts are typed like prices and converted on submit. */
export const deliveryZoneSchema = z.object({
  name: z
    .string()
    .overwrite(cleanLine)
    .min(1, "Ingresa la comuna o sector, ej. Providencia")
    .max(DELIVERY_ZONE_LIMITS.nameMax, `El nombre puede tener hasta ${DELIVERY_ZONE_LIMITS.nameMax} caracteres`),
  fee: priceText("Ingresa el costo de envío (0 si es gratis)", DELIVERY_ZONE_LIMITS.feeMax),
  minOrder: priceText("Ingresa el pedido mínimo (0 si no hay)", CASH_AMOUNT_MAX),
  active: z.boolean(),
  isHome: z.boolean(),
});

/** Rejecting and cancelling (staff) need a reason: the customer sees it (ChangeStatusDto.reason). */
export const statusReasonSchema = z.object({
  reason: z
    .string()
    .overwrite(cleanText)
    .min(1, "Indica el motivo: el cliente lo verá")
    .max(ORDER_LIMITS.rejectReasonMax, `El motivo puede tener hasta ${ORDER_LIMITS.rejectReasonMax} caracteres`),
});

const tableLabel = z
  .string()
  .overwrite(cleanLine)
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
    prefix: z.string().overwrite(cleanLine).max(TABLE_LABEL_MAX - 5, "El prefijo es demasiado largo"),
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
export type ItemsLimitValues = z.infer<typeof itemsLimitSchema>;
export type CategoryValues = z.infer<typeof categorySchema>;
export type ProductValues = z.infer<typeof productSchema>;
export type ModifierGroupValues = z.infer<typeof modifierGroupSchema>;
export type CheckoutValues = z.infer<typeof checkoutSchema>;
export type PickupCheckoutValues = z.infer<typeof pickupCheckoutSchema>;
export type DeliveryCheckoutValues = z.infer<ReturnType<typeof deliveryCheckoutSchema>>;
export type DeliveryZoneValues = z.infer<typeof deliveryZoneSchema>;
export type StatusReasonValues = z.infer<typeof statusReasonSchema>;
export type TableValues = z.infer<typeof tableSchema>;
export type BulkTablesValues = z.infer<typeof bulkTablesSchema>;
