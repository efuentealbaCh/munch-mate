import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { ApiErrorBody } from "./api-error";

/** Default codes for exceptions thrown without an explicit `apiError(...)` payload. */
const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHENTICATED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
};

/**
 * Normalizes every error response to {@link ApiErrorBody}.
 * The health endpoint is the exception: Terminus' body (per-dependency status) is passed through untouched.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(HttpExceptionFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error({ err: exception }, "unhandled exception");
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: "INTERNAL_ERROR",
        message: "Ocurrió un error inesperado",
      } satisfies ApiErrorBody);
      return;
    }

    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (isTerminusBody(payload)) {
      res.status(status).json(payload);
      return;
    }

    res.status(status).json(toApiErrorBody(status, payload, exception.message));
  }
}

function toApiErrorBody(status: number, payload: string | object, fallbackMessage: string): ApiErrorBody {
  const fallbackCode = CODE_BY_STATUS[status] ?? "ERROR";
  if (typeof payload === "string") {
    return { statusCode: status, code: fallbackCode, message: payload };
  }

  const body = payload as { code?: unknown; message?: unknown; meta?: unknown };
  // ValidationPipe reports one message per invalid field.
  if (Array.isArray(body.message)) {
    return {
      statusCode: status,
      code: "VALIDATION_FAILED",
      message: "Hay campos con errores",
      details: body.message.map(String),
    };
  }
  return {
    statusCode: status,
    code: typeof body.code === "string" ? body.code : fallbackCode,
    message: typeof body.message === "string" ? body.message : fallbackMessage,
    ...(isStringRecord(body.meta) ? { meta: body.meta } : {}),
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

function isTerminusBody(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "status" in payload && "details" in payload;
}
