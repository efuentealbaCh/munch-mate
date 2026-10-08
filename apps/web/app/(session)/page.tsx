import { ChefHatIcon, QrCodeIcon, TruckIcon } from "lucide-react";
import { Brand } from "@/components/brand";
import { LandingActions } from "./landing-actions";

const FEATURES = [
  { icon: QrCodeIcon, title: "Pedidos desde la mesa", text: "Tus clientes escanean el QR y piden sin esperar al garzón." },
  { icon: TruckIcon, title: "Retiro y delivery", text: "Un solo lugar para todos los pedidos, sin importar el canal." },
  { icon: ChefHatIcon, title: "Cocina en tiempo real", text: "El equipo ve cada pedido al instante, desde el celular." },
];

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Brand />
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-12 px-4 py-10 sm:px-6">
        <section className="flex max-w-2xl flex-col gap-5">
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Los pedidos de tu restaurante, <span className="text-primary">en un solo lugar</span>.
          </h1>
          <p className="text-lg text-muted-foreground text-pretty">
            Mesa, retiro y delivery. Crea tu restaurante, invita a tu equipo y empieza a recibir pedidos.
          </p>
          <LandingActions />
        </section>
        <ul className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
              <Icon className="mb-3 size-6 text-primary" aria-hidden />
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </main>
      <footer className="px-4 py-6 text-center text-xs text-muted-foreground">Munch Mate · Hecho en Chile</footer>
    </div>
  );
}
