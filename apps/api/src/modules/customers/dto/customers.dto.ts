import { CUSTOMER_LIMITS, ORDER_LIMITS } from "@app/types";
import { Transform, Type } from "class-transformer";
import { IsOptional, IsString, Length, MaxLength, ValidateIf, ValidateNested } from "class-validator";
import { cleanLine, cleanText } from "../../../common/validation/clean-text";
import { GeoPointDto } from "../../../common/validation/geo-point.dto";

export class ProfileDto {
  @IsOptional()
  @Transform(cleanLine)
  @IsString()
  @Length(1, 100, { message: "name debe tener entre 1 y 100 caracteres" })
  name?: string;

  /** Format checked and normalized by the service (normalizePhone); "" clears it. */
  @IsOptional()
  @Transform(cleanLine)
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class SavedAddressDto {
  @Transform(cleanLine)
  @IsString()
  @Length(1, CUSTOMER_LIMITS.addressLabelMax, { message: "Ponle un nombre, ej. Casa (hasta 30 caracteres)" })
  label!: string;

  @Transform(cleanLine)
  @IsString()
  @Length(3, ORDER_LIMITS.addressMax, { message: "Indica la calle y el número" })
  address!: string;

  @IsOptional()
  @Transform(cleanLine)
  @IsString()
  @MaxLength(ORDER_LIMITS.addressUnitMax)
  unit?: string;

  @IsOptional()
  @Transform(cleanText)
  @IsString()
  @MaxLength(ORDER_LIMITS.addressReferenceMax)
  reference?: string;

  @IsOptional()
  @ValidateIf((_: unknown, value: unknown) => value !== null)
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto | null;
}
