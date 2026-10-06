import { RESTAURANT_ROLES } from "@app/types";
import { slugProblem } from "@app/utils";
import { z } from "zod";
import { SLUG_PROBLEM_MESSAGES } from "./slug-field";

/**
 * Form schemas. Bounds mirror the api DTOs (apps/api/src/modules/{auth,restaurants}/dto) so most mistakes
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

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
export type RestaurantValues = z.infer<typeof restaurantSchema>;
export type InviteValues = z.infer<typeof inviteSchema>;
