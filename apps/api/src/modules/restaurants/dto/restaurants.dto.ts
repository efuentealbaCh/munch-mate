import {
  KITCHEN_TARGET_LIMITS,
  MESSAGE_CHANNELS,
  type MessageChannel,
  ORDER_LIMITS,
  RESTAURANT_ROLES,
  type RestaurantRole,
  TIP_LIMITS,
  type WeeklyHours,
} from "@app/types";
import { Transform, Type } from "class-transformer";
import { GeoPointDto } from "../../../common/validation/geo-point.dto";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { cleanLine, cleanText } from "../../../common/validation/clean-text";

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

const NAME_MESSAGE = { message: "name debe tener entre 2 y 100 caracteres" };
// Slug format is validated by the service (shared rules in @app/utils); here only a sanity bound.
const SLUG_BOUND = { message: "slug es demasiado largo" };

export class CreateRestaurantDto {
  @Transform(cleanLine)
  @IsString()
  @Length(2, 100, NAME_MESSAGE)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60, SLUG_BOUND)
  slug?: string;
}

/** WhatsApp/SMS notices; the sender phone is normalized and checked by the service. */
export class MessagingSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsIn(MESSAGE_CHANNELS)
  channel!: MessageChannel;

  @Transform(cleanLine)
  @IsString()
  @MaxLength(30, { message: "senderPhone debe ser un teléfono válido, ej. +569 12345678" })
  senderPhone!: string;
}

export class UpdateRestaurantDto {
  @IsOptional()
  @Transform(cleanLine)
  @IsString()
  @Length(2, 100, NAME_MESSAGE)
  name?: string;

  @IsOptional()
  @Transform(cleanText)
  @IsString()
  @MaxLength(300, { message: "description no puede superar 300 caracteres" })
  description?: string;

  /** Empty string clears it. */
  @IsOptional()
  @Transform(cleanLine)
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

  /** Units (sum of quantities) allowed in one order. */
  @IsOptional()
  @IsInt({ message: "maxItemsPerOrder debe ser un número entero" })
  @Min(ORDER_LIMITS.itemsPerOrderMin, { message: `El mínimo es ${ORDER_LIMITS.itemsPerOrderMin} producto por pedido` })
  @Max(ORDER_LIMITS.itemsPerOrderMax, { message: `El máximo es ${ORDER_LIMITS.itemsPerOrderMax} productos por pedido` })
  maxItemsPerOrder?: number;

  /** Suggested tip on table bills, percent (0 = none). */
  @IsOptional()
  @IsInt({ message: "tipPercent debe ser un número entero" })
  @Min(0, { message: "La propina sugerida no puede ser negativa" })
  @Max(TIP_LIMITS.percentMax, { message: `La propina sugerida puede ser como máximo ${TIP_LIMITS.percentMax} %` })
  tipPercent?: number;

  /** Minutes the owner expects from accepted to ready (the live view's kitchen goal). */
  @IsOptional()
  @IsInt({ message: "kitchenTargetMinutes debe ser un número entero" })
  @Min(KITCHEN_TARGET_LIMITS.minutesMin, {
    message: `La meta de cocina debe ser de al menos ${KITCHEN_TARGET_LIMITS.minutesMin} minutos`,
  })
  @Max(KITCHEN_TARGET_LIMITS.minutesMax, {
    message: `La meta de cocina puede ser como máximo ${KITCHEN_TARGET_LIMITS.minutesMax} minutos`,
  })
  kitchenTargetMinutes?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => MessagingSettingsDto)
  messaging?: MessagingSettingsDto;

  /** The restaurant on the map; null removes it. */
  @IsOptional()
  @ValidateIf((_: unknown, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto | null;
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
