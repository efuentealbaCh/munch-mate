"use client";

import type { PublicMenu, PublicProduct } from "@app/types";
import { ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { modifierRuleSummary } from "@/lib/menu";
import { formatPrice, formatPriceDelta } from "@/lib/money";
import { cn } from "@/lib/utils";

type Category = PublicMenu["categories"][number];

const sectionId = (categoryId: string) => `categoria-${categoryId}`;

/**
 * Interactive part of the public menu: sticky category bar (highlights the section in view) and the
 * product detail sheet. Rendered on the server too, so the whole menu is in the initial HTML.
 */
export function MenuBrowser({ categories, currency }: { categories: Category[]; currency: string }) {
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const active = useActiveSection(categories.map((category) => sectionId(category.id)));

  return (
    <>
      <CategoryNav categories={categories} active={active} />
      <main id="menu" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6">
        {categories.map((category) => (
          <section
            key={category.id}
            id={sectionId(category.id)}
            aria-labelledby={`${sectionId(category.id)}-title`}
            className="flex scroll-mt-16 flex-col gap-3"
          >
            <div className="flex flex-col gap-0.5">
              <h2 id={`${sectionId(category.id)}-title`} className="text-xl font-bold tracking-tight">
                {category.name}
              </h2>
              {category.description ? <p className="text-sm text-muted-foreground">{category.description}</p> : null}
            </div>
            <ul className="flex flex-col gap-3">
              {category.products.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} currency={currency} onOpen={() => setSelected(product)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
      <ProductDetail product={selected} currency={currency} onClose={() => setSelected(null)} />
    </>
  );
}

/**
 * Id of the section currently at the top of the viewport (just below the sticky bar).
 * @param ids Section element ids, in page order.
 */
function useActiveSection(ids: string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join("|");

  useEffect(() => {
    const sections = key
      .split("|")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // The first section (in page order) that crosses the band below the bar wins.
        const first = sections.find((section) => visible.has(section.id));
        if (first) setActive(first.id);
      },
      // A band from just under the sticky bar to 60% of the viewport.
      { rootMargin: "-64px 0px -40% 0px" },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [key]);

  return active;
}

function CategoryNav({ categories, active }: { categories: Category[]; active: string | undefined }) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the highlighted category visible inside the horizontally scrolling bar.
  useEffect(() => {
    if (!active) return;
    const link = listRef.current?.querySelector<HTMLElement>(`a[href="#${active}"]`);
    link?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <nav aria-label="Categorías del menú" className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <ul ref={listRef} className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none]">
        {categories.map((category) => {
          const id = sectionId(category.id);
          const current = id === active;
          return (
            <li key={category.id} className="shrink-0">
              <a
                href={`#${id}`}
                aria-current={current ? "location" : undefined}
                className={cn(
                  "flex min-h-10 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  current ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-brand-soft",
                )}
              >
                {category.name}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ProductCard({ product, currency, onOpen }: { product: PublicProduct; currency: string; onOpen(): void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        "flex w-full items-start gap-3 rounded-xl bg-card p-3 text-left ring-1 ring-foreground/10 transition-shadow outline-none hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50",
        !product.available && "opacity-60",
      )}
      data-testid="public-product"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold break-words">{product.name}</span>
        {product.description ? <span className="line-clamp-2 text-sm text-muted-foreground">{product.description}</span> : null}
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-semibold tabular-nums">{formatPrice(product.price, currency)}</span>
          {product.available ? null : <Badge variant="destructive">Agotado</Badge>}
        </span>
      </span>
      {product.image ? (
        <img
          src={product.image.md}
          srcSet={`${product.image.sm} 160w, ${product.image.md} 480w, ${product.image.lg} 960w`}
          sizes="(min-width: 640px) 144px, 112px"
          width={160}
          height={120}
          loading="lazy"
          decoding="async"
          alt=""
          className="aspect-[4/3] w-28 shrink-0 rounded-lg bg-muted object-cover sm:w-36"
          data-testid="product-photo"
        />
      ) : null}
    </button>
  );
}

function ProductDetail({ product, currency, onClose }: { product: PublicProduct | null; currency: string; onClose(): void }) {
  // Keep the last product while the sheet animates out.
  const [shown, setShown] = useState<PublicProduct | null>(product);
  if (product && product !== shown) setShown(product);

  return (
    <Sheet open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[90dvh] gap-0 overflow-y-auto rounded-t-2xl sm:max-w-lg"
      >
        {shown ? (
          <div className="flex flex-col">
            {shown.image ? (
              <img
                src={shown.image.lg}
                srcSet={`${shown.image.md} 480w, ${shown.image.lg} 960w`}
                sizes="(min-width: 640px) 512px, 100vw"
                width={960}
                height={720}
                alt=""
                className="aspect-[4/3] w-full bg-muted object-cover"
              />
            ) : (
              <span className="flex aspect-[4/1] w-full items-center justify-center bg-muted text-muted-foreground" aria-hidden>
                <ImageIcon className="size-8" />
              </span>
            )}
            <SheetHeader className="gap-1 pr-12">
              <SheetTitle className="text-xl font-bold">{shown.name}</SheetTitle>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold tabular-nums">{formatPrice(shown.price, currency)}</span>
                {shown.available ? null : <Badge variant="destructive">Agotado</Badge>}
              </div>
              <SheetDescription className={shown.description ? "text-base" : "sr-only"}>
                {shown.description || "Detalle del producto"}
              </SheetDescription>
            </SheetHeader>

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
              Muy pronto podrás pedir desde aquí.
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
