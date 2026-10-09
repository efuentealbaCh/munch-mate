import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brand />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Página no encontrada</h1>
        <p className="text-muted-foreground">La dirección no existe o cambió.</p>
      </div>
      <Button asChild>
        <Link href="/">Ir al inicio</Link>
      </Button>
    </main>
  );
}
