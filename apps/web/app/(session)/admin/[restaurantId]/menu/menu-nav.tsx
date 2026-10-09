"use client";

import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Sub-sections of the menu editor plus a shortcut to the public menu. */
export function MenuNav({ restaurantId, slug, current }: { restaurantId: string; slug: string; current: "products" | "modifiers" }) {
  const base = `/admin/${restaurantId}/menu`;
  const links = [
    { key: "products", href: base, label: "Productos" },
    { key: "modifiers", href: `${base}/modificadores`, label: "Modificadores" },
  ] as const;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Secciones del menú">
        <ul className="inline-flex rounded-lg bg-muted p-1">
          {links.map((link) => {
            const active = link.key === current;
            return (
              <li key={link.key}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-9 items-center rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Button asChild variant="outline" size="sm">
        <a href={`/r/${slug}`} target="_blank" rel="noopener">
          Ver menú público
          <ExternalLinkIcon aria-hidden data-icon="inline-end" />
          <span className="sr-only">(se abre en una pestaña nueva)</span>
        </a>
      </Button>
    </div>
  );
}
