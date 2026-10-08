import { MENU_LIMITS } from "@app/types";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const NAME = { message: `name debe tener entre 1 y ${MENU_LIMITS.nameMax} caracteres` };
const DESCRIPTION = { message: `description no puede superar ${MENU_LIMITS.descriptionMax} caracteres` };
const PRICE = { message: `debe ser un entero entre 0 y ${MENU_LIMITS.priceMax}` };

export class CreateCategoryDto {
  @Transform(trim)
  @IsString()
  @Length(1, MENU_LIMITS.nameMax, NAME)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MENU_LIMITS.descriptionMax, DESCRIPTION)
  description?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, MENU_LIMITS.nameMax, NAME)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MENU_LIMITS.descriptionMax, DESCRIPTION)
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** New display order: every id of the list, each exactly once. */
export class OrderDto {
  @IsArray()
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  ids!: string[];
}

export class CreateProductDto {
  @IsMongoId()
  categoryId!: string;

  @Transform(trim)
  @IsString()
  @Length(1, MENU_LIMITS.nameMax, NAME)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MENU_LIMITS.descriptionMax, DESCRIPTION)
  description?: string;

  /** Integer in the currency's minor unit (CLP: 3990 = $3.990). */
  @IsInt(PRICE)
  @Min(0, PRICE)
  @Max(MENU_LIMITS.priceMax, PRICE)
  price!: number;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MENU_LIMITS.groupsPerProductMax)
  @ArrayUnique()
  @IsMongoId({ each: true })
  modifierGroupIds?: string[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, MENU_LIMITS.nameMax, NAME)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MENU_LIMITS.descriptionMax, DESCRIPTION)
  description?: string;

  @IsOptional()
  @IsInt(PRICE)
  @Min(0, PRICE)
  @Max(MENU_LIMITS.priceMax, PRICE)
  price?: number;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MENU_LIMITS.groupsPerProductMax)
  @ArrayUnique()
  @IsMongoId({ each: true })
  modifierGroupIds?: string[];
}

export class AvailabilityDto {
  @IsBoolean()
  available!: boolean;
}

export class ModifierOptionDto {
  /** Present when editing an existing option, so its id is kept. */
  @IsOptional()
  @IsMongoId()
  id?: string;

  @Transform(trim)
  @IsString()
  @Length(1, MENU_LIMITS.nameMax, NAME)
  name!: string;

  @IsInt(PRICE)
  @Min(0, PRICE)
  @Max(MENU_LIMITS.priceMax, PRICE)
  priceDelta!: number;

  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class ModifierGroupDto {
  @Transform(trim)
  @IsString()
  @Length(1, MENU_LIMITS.nameMax, NAME)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(MENU_LIMITS.optionsPerGroupMax)
  minSelect!: number;

  @IsInt()
  @Min(1)
  @Max(MENU_LIMITS.optionsPerGroupMax)
  maxSelect!: number;

  @IsArray()
  @ArrayMinSize(1, { message: "options debe tener al menos una opción" })
  @ArrayMaxSize(MENU_LIMITS.optionsPerGroupMax)
  @ValidateNested({ each: true })
  @Type(() => ModifierOptionDto)
  options!: ModifierOptionDto[];
}
