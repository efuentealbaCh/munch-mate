import {
  KITCHEN_PRINT_RULES,
  type KitchenPrintRule,
  PRINT_JOB_STATUSES,
  PRINT_LIMITS,
  PRINT_PAPERS,
  type PrintJobStatus,
  type PrintPaper,
} from "@app/types";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { cleanLine } from "../../../common/validation/clean-text";

/** Body of `POST /api/print-agents/pair` (sent by the agent). */
export class PairPrintAgentDto {
  /** Normalized by the service (case, spaces and dashes ignored). */
  @IsString()
  @MaxLength(20)
  code!: string;

  @Transform(cleanLine)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRINT_LIMITS.agentNameMax)
  name!: string;

  @Transform(cleanLine)
  @IsString()
  @MaxLength(PRINT_LIMITS.appVersionMax)
  appVersion!: string;
}

export class RenamePrintAgentDto {
  @Transform(cleanLine)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRINT_LIMITS.agentNameMax)
  name!: string;
}

/** Body of `PATCH .../print-agents/:agentId/printers/:printerKey`: only the fields sent change. */
export class UpdatePrinterDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(PRINT_PAPERS)
  paper?: PrintPaper;

  @IsOptional()
  @IsIn(KITCHEN_PRINT_RULES)
  kitchen?: KitchenPrintRule;

  /** Categories of this restaurant ([] = every category); checked by the service (400 INVALID_CATEGORY). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PRINT_LIMITS.categoriesPerPrinter)
  @IsMongoId({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsBoolean()
  receipts?: boolean;

  @IsOptional()
  @IsInt()
  @Min(PRINT_LIMITS.copiesMin)
  @Max(PRINT_LIMITS.copiesMax)
  copies?: number;
}

/** `GET .../print-agents/jobs?status=failed&limit=20`. */
export class PrintJobsQueryDto {
  @IsOptional()
  @IsIn(PRINT_JOB_STATUSES)
  status?: PrintJobStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRINT_LIMITS.jobsListMax)
  limit?: number;
}
