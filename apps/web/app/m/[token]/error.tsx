"use client";

import { CloudOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The api failed or timed out while rendering the table page (details stay in the server logs). */
export default function TableError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <CloudOffIcon className="size-10 text-muted-foreground" aria-hidden />
      <div role="alert" className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">No pudimos cargar el menú</h1>
        <p className="text-muted-foreground">Revisa tu conexión e intenta de nuevo en unos segundos.</p>
      </div>
      <Button onClick={() => retry()}>Reintentar</Button>
    </main>
  );
}
