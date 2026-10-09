import { MENU_LIMITS } from "@app/types";
import { BadRequestException, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { apiError } from "../errors/api-error";

/** Shape of the multer file we use (memory storage). Declared locally to avoid multer's global types. */
export interface UploadedImageFile {
  buffer: Buffer;
  size: number;
}

/**
 * Accepts one multipart field named `file`, kept in memory, up to MENU_LIMITS.imageMaxBytes.
 * Larger files are rejected by multer with 413 before reaching the handler. The content type the client
 * sends is ignored: the image processor validates the actual bytes.
 */
export const ImageUpload = () =>
  UseInterceptors(FileInterceptor("file", { limits: { fileSize: MENU_LIMITS.imageMaxBytes, files: 1, fields: 0 } }));

/** @throws BadRequestException FILE_REQUIRED when the request had no `file` field. */
export function requireImage(file: UploadedImageFile | undefined): Buffer {
  if (!file?.buffer?.length) {
    throw new BadRequestException(apiError("FILE_REQUIRED", "Adjunta una imagen en el campo «file»"));
  }
  return file.buffer;
}
