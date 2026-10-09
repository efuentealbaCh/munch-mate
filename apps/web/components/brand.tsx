import { UtensilsCrossedIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** App logo + name, linking to `href`. */
export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md text-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
        <UtensilsCrossedIcon className="size-4" />
      </span>
      Munch Mate
    </Link>
  );
}
