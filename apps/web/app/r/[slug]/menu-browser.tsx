"use client";

import type { PublicProduct } from "@app/types";
import { useState } from "react";
import { type PublicCategory, MenuSections, ProductSheetHeader, useLastNonNull } from "@/components/public-menu";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { modifierRuleSummary } from "@/lib/menu";
import { formatPriceDelta } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Interactive part of the public (read-only) menu: sticky category bar (highlights the section in view) and
 * the product detail sheet. Ordering happens from a table QR (/m/[token]).
 */
export function MenuBrowser({ categories, currency }: { categories: PublicCategory[]; currency: string }) {
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  return (
    <>
      <MenuSections categories={categories} currency={currency} onOpen={setSelected} />
      <ProductDetail product={selected} currency={currency} onClose={() => setSelected(null)} />
    </>
  );
}

function ProductDetail({ product, currency, onClose }: { product: PublicProduct | null; currency: string; onClose(): void }) {
  // Keep the last product while the sheet animates out.
  const shown = useLastNonNull(product);

  return (
    <Sheet open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-h-[90dvh] gap-0 overflow-y-auto rounded-t-2xl sm:max-w-lg">
        {shown ? (
          <div className="flex flex-col">
            <ProductSheetHeader product={shown} currency={currency} />

            {shown.modifierGroups.length > 0 ? (
              <div className="flex flex-col gap-4 px-4 pb-2">
                {shown.modifierGroups.map((group) => (
                  <section key={group.id} aria-labelledby={`grupo-${group.id}`} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b pb-1">
                      <h3 id={`grupo-${group.id}`} className="font-semibold">
                        {group.name}
                      </h3>
                      <span className="text-sm text-muted-foreground">{modifierRuleSummary(group.minSelect, group.maxSelect)}</span>
                    </div>
                    <ul className="flex flex-col gap-1.5 text-sm">
                      {group.options.map((option) => (
                        <li key={option.id} className={cn("flex items-center justify-between gap-2", !option.available && "text-muted-foreground")}>
                          <span className="flex items-center gap-2">
                            <span className={cn(!option.available && "line-through")}>{option.name}</span>
                            {option.available ? null : <Badge variant="destructive">Agotado</Badge>}
                          </span>
                          <span className="tabular-nums">{formatPriceDelta(option.priceDelta, currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : null}

            <p className="m-4 rounded-lg bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
              Para pedir, escanea el código QR de tu mesa.
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
