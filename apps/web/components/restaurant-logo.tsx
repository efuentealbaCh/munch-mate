import type { LogoImage } from "@app/types";
import { StoreIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = { sm: "size-11", md: "size-14", lg: "size-20" } as const;

/**
 * Restaurant logo (square WebP from the api: sm 96 px, md 256 px), or a store icon when there is none.
 * Plain <img>: the files are already optimized and served from the media host, no Next optimization needed.
 * Decorative by default (the restaurant name is always next to it).
 */
export function RestaurantLogo({
  logo,
  size = "sm",
  className,
}: {
  logo: LogoImage | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (!logo) {
    return (
      <span
        className={cn("flex shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-foreground", SIZES[size], className)}
        aria-hidden
      >
        <StoreIcon className="size-1/2" />
      </span>
    );
  }
  return (
    <img
      src={logo.sm}
      srcSet={`${logo.sm} 96w, ${logo.md} 256w`}
      sizes={size === "lg" ? "80px" : size === "md" ? "56px" : "44px"}
      width={96}
      height={96}
      alt=""
      className={cn("shrink-0 rounded-lg bg-white object-contain ring-1 ring-foreground/10", SIZES[size], className)}
    />
  );
}
