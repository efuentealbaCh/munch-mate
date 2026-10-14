import {
  FLOOR_LIMITS,
  type FloorCell,
  type FloorPlan,
  type FloorRect,
  type SaveFloorPlanInput,
  TABLE_ROTATIONS,
  TABLE_SEATS,
  TABLE_SHAPES,
  type TableLayoutInput,
  type TableRotation,
  type TableSeats,
  type TableShape,
} from "@app/types";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

// Shape and bounds only: how the pieces fit together (areas, door, overlaps) is checked by the service with
// `floorPlanProblem` (@app/utils), the same rules the editor uses.
const CELL = { message: "Las posiciones del plano deben ser celdas enteras dentro del plano" };
const MAX_CELL = Math.max(FLOOR_LIMITS.colsMax, FLOOR_LIMITS.rowsMax);

export class FloorRectDto implements FloorRect {
  @IsInt(CELL)
  @Min(0, CELL)
  @Max(MAX_CELL, CELL)
  x!: number;

  @IsInt(CELL)
  @Min(0, CELL)
  @Max(MAX_CELL, CELL)
  y!: number;

  @IsInt(CELL)
  @Min(1, CELL)
  @Max(MAX_CELL, CELL)
  w!: number;

  @IsInt(CELL)
  @Min(1, CELL)
  @Max(MAX_CELL, CELL)
  h!: number;
}

export class FloorCellDto implements FloorCell {
  @IsInt(CELL)
  @Min(0, CELL)
  @Max(MAX_CELL, CELL)
  x!: number;

  @IsInt(CELL)
  @Min(0, CELL)
  @Max(MAX_CELL, CELL)
  y!: number;
}

export class FloorPlanDto {
  @IsInt({ message: "cols debe ser un número entero" })
  cols!: number;

  @IsInt({ message: "rows debe ser un número entero" })
  rows!: number;

  /** Optional here so a missing kitchen answers INVALID_FLOOR_PLAN `kitchen_required` like the editor. */
  @IsOptional()
  @ValidateNested()
  @Type(() => FloorRectDto)
  kitchen?: FloorRectDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => FloorRectDto)
  pickup?: FloorRectDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => FloorCellDto)
  door?: FloorCellDto | null;
}

export class TableLayoutDto implements TableLayoutInput {
  @IsInt(CELL)
  @Min(0, CELL)
  @Max(MAX_CELL, CELL)
  x!: number;

  @IsInt(CELL)
  @Min(0, CELL)
  @Max(MAX_CELL, CELL)
  y!: number;

  @IsIn(TABLE_SHAPES, { message: "La forma de la mesa debe ser redonda o cuadrada" })
  shape!: TableShape;

  @IsIn(TABLE_SEATS, { message: "Las mesas pueden ser de 2, 4, 6 u 8 puestos" })
  seats!: TableSeats;

  /** Missing = 0 (horizontal), so clients older than the rotation keep working. */
  @IsOptional()
  @IsIn(TABLE_ROTATIONS, { message: "La mesa puede estar horizontal (0) o vertical (90)" })
  rotation?: TableRotation;
}

export class TablePlacementDto {
  /** Unknown ids (or of another restaurant) answer 400 UNKNOWN_TABLE from the service. */
  @IsString()
  @Length(1, 64)
  tableId!: string;

  /** null or missing = off the plan. */
  @IsOptional()
  @ValidateNested()
  @Type(() => TableLayoutDto)
  layout?: TableLayoutDto | null;
}

/** Body of `PUT /restaurants/:id/floor-plan` (SaveFloorPlanInput). */
export class SaveFloorPlanDto {
  /** Required key: null deletes the plan and every table layout. */
  @ValidateIf((_: unknown, value: unknown) => value !== null)
  @IsDefined({ message: "plan es obligatorio (null para borrar el plano)" })
  @IsObject()
  @ValidateNested()
  @Type(() => FloorPlanDto)
  plan!: FloorPlanDto | null;

  /** Placed tables; tables not listed are taken off the plan. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FLOOR_LIMITS.tablesMax)
  @ValidateNested({ each: true })
  @Type(() => TablePlacementDto)
  tables?: TablePlacementDto[];
}

/**
 * The validated body as the service input: missing optional pieces become null and the kitchen stays as
 * sent (possibly null) so `floorPlanProblem` reports `kitchen_required`.
 */
export function toSaveFloorPlanInput(dto: SaveFloorPlanDto): SaveFloorPlanInput {
  const plan: FloorPlan | null = dto.plan && {
    cols: dto.plan.cols,
    rows: dto.plan.rows,
    kitchen: (dto.plan.kitchen ?? null) as FloorRect,
    pickup: dto.plan.pickup ?? null,
    door: dto.plan.door ?? null,
  };
  return { plan, tables: (dto.tables ?? []).map((t) => ({ tableId: t.tableId, layout: t.layout ?? null })) };
}
