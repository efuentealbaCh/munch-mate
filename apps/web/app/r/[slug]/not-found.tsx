import { SearchXIcon } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

/** Unknown or suspended restaurant (api 404 MENU_NOT_FOUND). */
export default function MenuNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <SearchXIcon className="size-10 text-muted-foreground" aria-hidden />
      <div className="flex max-w-sm flex-col gap-1">
        <h1 className="text-2xl font-bold">No encontramos este menú</h1>
        <p className="text-muted-foreground">
          Puede que la dirección esté mal escrita o que el restaurante la haya cambiado. Pídeles el enlace actualizado.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Ir al inicio</Link>
      </Button>
      <Brand className="mt-6 text-base" />
    </main>
  );
}
