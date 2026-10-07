import { QrCodeIcon } from "lucide-react";
import { Brand } from "@/components/brand";

/** Unknown, inactive or regenerated table code, or a suspended restaurant (api 404 TABLE_NOT_FOUND). */
export default function TableNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <QrCodeIcon className="size-10 text-muted-foreground" aria-hidden />
      <div className="flex max-w-sm flex-col gap-1">
        <h1 className="text-2xl font-bold">Este código QR no está activo</h1>
        <p className="text-muted-foreground">Pide ayuda al personal del local para hacer tu pedido.</p>
      </div>
      <Brand className="mt-6 text-base" />
    </main>
  );
}
