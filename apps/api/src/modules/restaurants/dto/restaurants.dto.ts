import { RESTAURANT_ROLES, type RestaurantRole } from "@app/types";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
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
  @IsString()
  @MaxLength(60, SLUG_BOUND)
  slug?: string;
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
