import { RESTAURANT_ROLES, type RestaurantRole, type WeeklyHours } from "@app/types";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

const NAME_MESSAGE = { message: "name debe tener entre 2 y 100 caracteres" };
// Slug format is validated by the service (shared rules in @app/utils); here only a sanity bound.
const SLUG_BOUND = { message: "slug es demasiado largo" };

export class CreateRestaurantDto {
  @Transform(trim)
  @IsString()
  @Length(2, 100, NAME_MESSAGE)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60, SLUG_BOUND)
  slug?: string;
}

export class UpdateRestaurantDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100, NAME_MESSAGE)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300, { message: "description no puede superar 300 caracteres" })
  description?: string;

  /** Empty string clears it. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  // Format checked and normalized by the service with normalizePhone (same rules as customer phones).
  @MaxLength(30, { message: "phone debe ser un teléfono válido, ej. +569 12345678" })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60, SLUG_BOUND)
  slug?: string;

  /** Lets customers order for pickup from the public menu. */
  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  /** Lets customers order for delivery to the restaurant's zones. */
  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;
}

export class SlugQueryDto {
  @IsString()
  @Length(1, 60)
  slug!: string;
}

class RolesDto {
  @IsArray()
  @ArrayMinSize(1, { message: "roles debe incluir al menos un rol" })
  @ArrayMaxSize(RESTAURANT_ROLES.length)
  @ArrayUnique()
  @IsIn(RESTAURANT_ROLES, { each: true, message: `cada rol debe ser uno de: ${RESTAURANT_ROLES.join(", ")}` })
  roles!: RestaurantRole[];
}

export class UpdateMemberRolesDto extends RolesDto {}

export class InviteDto extends RolesDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: "email no es un correo válido" })
  @MaxLength(254)
  email!: string;
}

/** The content (7 days, ranges, times) is validated by the service with the shared rules of @app/utils. */
export class OpeningHoursDto {
  @ValidateIf((o: OpeningHoursDto) => o.openingHours !== null)
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  openingHours!: WeeklyHours | null;
}

export class AcceptingOrdersDto {
  @IsBoolean()
  acceptingOrders!: boolean;
}
