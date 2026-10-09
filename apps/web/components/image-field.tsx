"use client";

import { ImageIcon, ImageUpIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IMAGE_ACCEPT, imageDimensionsProblem, imageFileProblem } from "@/lib/menu";
import { cn } from "@/lib/utils";

/**
 * Reads the pixel size of an image file in the browser.
 * @returns null when the browser cannot decode it (e.g. AVIF on an old browser): the api validates anyway.
 */
async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

interface ImageFieldProps {
  label: string;
  /** Help text under the buttons (formats, minimum size). */
  description?: ReactNode;
  /** URL of the stored image, or null. */
  imageUrl: string | null;
  /** Photos are 4:3; logos are square (letterboxed by the api). */
  shape: "photo" | "logo";
  /** Uploads the validated file. Rejections are shown inside the field. */
  onUpload(file: File): Promise<void>;
  onRemove(): Promise<void>;
  disabled?: boolean;
}

/**
 * Picks, validates (type, 8 MB, 200×200 px) and uploads an image right away, showing a local preview and a
 * spinner while the upload runs. fetch() has no upload progress events, so there is no percentage.
 */
export function ImageField({ label, description, imageUrl, shape, onUpload, onRemove, disabled }: ImageFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function handleFile(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = ""; // picking the same file again must fire onChange
    if (!file) return;
    setError(null);
    const fileProblem = imageFileProblem(file);
    const size = fileProblem ? null : await readImageSize(file);
    const localProblem = fileProblem ?? (size ? imageDimensionsProblem(size.width, size.height) : null);
    setProblem(localProblem);
    if (localProblem) return;

    setPreview(URL.createObjectURL(file));
    setBusy("upload");
    try {
      await onUpload(file);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
      setPreview(null);
    }
  }

  async function remove() {
    setError(null);
    setProblem(null);
    setBusy("remove");
    try {
      await onRemove();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
    }
  }

  const shown = preview ?? imageUrl;
  const descriptionId = `${id}-description`;

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={`${id}-label`} aria-busy={busy !== null || undefined}>
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10",
            shape === "photo" ? "aspect-[4/3] w-32" : "size-20 bg-white",
          )}
        >
          {shown ? (
            // Plain <img>: blob: previews and already optimized media-host URLs need no Next optimization.
            <img
              src={shown}
              alt={preview ? "Vista previa" : "Imagen actual"}
              className={cn("size-full", shape === "photo" ? "object-cover" : "object-contain")}
            />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
          )}
          {busy === "upload" ? (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Spinner className="size-6" aria-label="Subiendo imagen" />
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            id={`${id}-input`}
            type="file"
            accept={IMAGE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-describedby={description ? descriptionId : undefined}
            disabled={disabled || busy !== null}
            onChange={(event) => void handleFile(event.target.files?.[0])}
            data-testid="image-input"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy !== null}
            aria-describedby={description ? descriptionId : undefined}
            onClick={() => inputRef.current?.click()}
          >
            <ImageUpIcon aria-hidden data-icon="inline-start" />
            {busy === "upload" ? "Subiendo…" : imageUrl ? "Cambiar imagen" : "Subir imagen"}
          </Button>
          {imageUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || busy !== null}
              onClick={() => void remove()}
            >
              {busy === "remove" ? <Spinner aria-hidden data-icon="inline-start" /> : <Trash2Icon aria-hidden data-icon="inline-start" />}
              Quitar
            </Button>
          ) : null}
        </div>
      </div>
      {description ? (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      <FormError error={error} message={problem} />
    </div>
  );
}
