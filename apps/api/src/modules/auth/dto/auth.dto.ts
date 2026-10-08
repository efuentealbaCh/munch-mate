import { Transform } from "class-transformer";
import { IsEmail, IsString, Length, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

/** NIST SP 800-63B: length over composition rules. The upper bound limits argon2 work per request. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: "email no es un correo válido" })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: `password debe tener al menos ${PASSWORD_MIN} caracteres` })
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100, { message: "name debe tener entre 1 y 100 caracteres" })
  name!: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: "email no es un correo válido" })
  @MaxLength(254)
  email!: string;

  // No minimum: the login form must not reveal the password policy, and old passwords may predate it.
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: "email no es un correo válido" })
  @MaxLength(254)
  email!: string;
}

export class TokenDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MinLength(PASSWORD_MIN, { message: `password debe tener al menos ${PASSWORD_MIN} caracteres` })
  @MaxLength(PASSWORD_MAX)
  password!: string;
}
