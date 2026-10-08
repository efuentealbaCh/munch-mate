import { ClockIcon, PhoneIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicOpeningHours } from "@/components/public-opening-hours";
import { RestaurantLogo } from "@/components/restaurant-logo";
import { telHref } from "@/lib/format";
import { getPublicMenu } from "@/lib/public-menu";
import { MenuBrowser } from "./menu-browser";
import { OnlineOrdering } from "./online-ordering";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/*
 * Rendered on every request (headers() makes the route dynamic): the menu is always current, and the
 * visitor's IP reaches the api's per-IP rate limit. See lib/public-menu.ts for why there is no data cache.
 */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublicMenu(slug);
  if (result.status !== "ok") return { title: "Menú" };
  const { restaurant } = result.menu;
  const description = restaurant.description || `Menú de ${restaurant.name}`;
  return {
    title: { absolute: restaurant.name },
    description,
    openGraph: {
      title: restaurant.name,
      description,
      ...(restaurant.logo ? { images: [{ url: restaurant.logo.md, width: 256, height: 256 }] } : {}),
    },
  };
}

export default async function PublicMenuPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await getPublicMenu(slug);
  if (result.status === "not_found") notFound();
  if (result.status === "busy") return <Busy />;

  const { restaurant, categories } = result.menu;
  const ordersOnline = restaurant.pickupEnabled || restaurant.deliveryEnabled;
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-start gap-4 px-4 py-5">
          <RestaurantLogo logo={restaurant.logo} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight break-words">{restaurant.name}</h1>
            {restaurant.description ? <p className="text-sm text-muted-foreground">{restaurant.description}</p> : null}
            {restaurant.phone ? (
              <a
                href={telHref(restaurant.phone)}
                className="mt-1 inline-flex min-h-8 items-center gap-1.5 self-start rounded-md text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <PhoneIcon className="size-4" aria-hidden />
                <span className="sr-only">Llamar al </span>
                {restaurant.phone}
              </a>
            ) : null}
            {restaurant.openingHours ? <PublicOpeningHours hours={restaurant.openingHours} /> : null}
          </div>
        </div>
      </header>

      {ordersOnline ? (
        // Pickup and/or delivery on: cart and checkout (the open/closed banner lives inside, it follows live refreshes).
        <OnlineOrdering initialMenu={result.menu} />
      ) : categories.length === 0 ? (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-2 px-4 py-16 text-center">
          <ClockIcon className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">El menú se está preparando</h2>
          <p className="text-sm text-muted-foreground">Vuelve pronto para ver los productos de {restaurant.name}.</p>
        </main>
      ) : (
        <MenuBrowser categories={categories} currency={restaurant.currency} />
      )}

      <footer className="border-t px-4 py-6 text-center text-xs text-muted-foreground">
        {ordersOnline ? "Pedidos con" : "Menú creado con"} <span className="font-semibold text-foreground">Munch Mate</span>
      </footer>
    </div>
  );
}

function Busy() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center" role="alert">
      <h1 className="text-xl font-semibold">Hay muchas visitas en este momento</h1>
      <p className="text-muted-foreground">Espera un minuto y recarga la página para ver el menú.</p>
    </main>
  );
}
