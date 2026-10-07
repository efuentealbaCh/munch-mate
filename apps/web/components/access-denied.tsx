import { LockIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Shown when a member opens a restaurant section their roles do not allow (e.g. a direct URL).
 * The api rejects the requests anyway (403 FORBIDDEN_ROLE); this only explains it.
 */
export function AccessDenied({
  restaurantId,
  title = "Solo para dueños",
  description,
}: {
  restaurantId: string;
  title?: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center" role="status">
      <LockIcon className="size-8 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button asChild variant="outline">
        <Link href={`/admin/${restaurantId}`}>Volver al resumen</Link>
      </Button>
    </div>
  );
}
