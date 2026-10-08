"use client";

import type { PublicMenu, PublicProduct } from "@app/types";
import { ImageIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Pieces of the customer-facing menu shared by the read-only menu (/r/[slug]) and the table ordering page
 * (/m/[token]): the sticky category bar, the product list and the top of the product sheet.
 */

export type PublicCategory = PublicMenu["categories"][number];

const sectionId = (categoryId: string) => `categoria-${categoryId}`;

/** Category bar + one section per category. Rendered on the server too, so the menu is in the initial HTML. */
export function MenuSections({
  categories,
  currency,
  onOpen,
  className,
}: {
  categories: PublicCategory[];
  currency: string;
  onOpen(product: PublicProduct): void;
  className?: string;
}) {
  const active = useActiveSection(categories.map((category) => sectionId(category.id)));
  return (
    <>
      <CategoryNav categories={categories} active={active} />
      <main id="menu" className={cn("mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6", className)}>
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
                  <ProductCard product={product} currency={currency} onOpen={() => onOpen(product)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
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

function CategoryNav({ categories, active }: { categories: PublicCategory[]; active: string | undefined }) {
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

/** Photo, name, price and description at the top of the product sheet. */
export function ProductSheetHeader({ product, currency, price }: { product: PublicProduct; currency: string; price?: ReactNode }) {
  return (
    <>
      {product.image ? (
        <img
          src={product.image.lg}
          srcSet={`${product.image.md} 480w, ${product.image.lg} 960w`}
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
        <SheetTitle className="text-xl font-bold">{product.name}</SheetTitle>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-semibold tabular-nums">{price ?? formatPrice(product.price, currency)}</span>
          {product.available ? null : <Badge variant="destructive">Agotado</Badge>}
        </div>
        <SheetDescription className={product.description ? "text-base" : "sr-only"}>
          {product.description || "Detalle del producto"}
        </SheetDescription>
      </SheetHeader>
    </>
  );
}

/** Keeps the last non-null value while a sheet animates out (its content must not vanish mid-animation). */
export function useLastNonNull<T>(value: T | null): T | null {
  const [shown, setShown] = useState<T | null>(value);
  if (value !== null && value !== shown) setShown(value);
  return shown;
}
