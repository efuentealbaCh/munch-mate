import type { RestaurantStatus } from "@app/types";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

const STATUSES: RestaurantStatus[] = ["active", "suspended"];

export class PlatformRestaurantsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: RestaurantStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}

export class RestaurantStatusDto {
  @IsIn(STATUSES, { message: "status debe ser active o suspended" })
  status!: RestaurantStatus;
}
