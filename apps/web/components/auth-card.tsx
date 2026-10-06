import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while an auth page reads its query string (Suspense fallback). */
export function AuthCardSkeleton() {
  return (
    <Card className="gap-4 p-6" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </Card>
  );
}

/** Card used by every page of the (auth) route group. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="gap-6 py-6 [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]">
      <CardHeader>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
      {footer ? (
        <div className="flex flex-col gap-2 border-t px-(--card-spacing) pt-5 text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </Card>
  );
}
