import type { ProductImage } from "@app/types";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small 4:3 product photo for lists (image.sm is 160 px wide), or a placeholder icon. Decorative. */
export function ProductThumbnail({ image, className }: { image: ProductImage | null; className?: string }) {
  const box = cn("aspect-[4/3] w-16 shrink-0 overflow-hidden rounded-md bg-muted", className);
  if (!image) {
    return (
      <span className={cn(box, "flex items-center justify-center text-muted-foreground")} aria-hidden>
        <ImageIcon className="size-5" />
      </span>
    );
  }
  return (
    <img
      src={image.sm}
      srcSet={`${image.sm} 160w, ${image.md} 480w`}
      sizes="64px"
      width={160}
      height={120}
      loading="lazy"
      alt=""
      className={cn(box, "object-cover")}
    />
  );
}
