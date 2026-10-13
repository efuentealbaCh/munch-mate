import { UserRoundCheckIcon } from "lucide-react";
import Link from "next/link";

export interface AccountHintProps {
  status: "loading" | "guest" | "customer";
  /** /ingresar with `next` back to this menu (built with safeNextPath). */
  loginHref: string;
}

/**
 * One discreet line above the checkout's contact fields (phase 6): guests can log in to use their saved data
 * (the cart survives the round trip: it lives in sessionStorage); customers are told the order goes to
 * "Mis pedidos". Nothing while the session is being checked, so the line does not flicker.
 */
export function AccountHint({ account }: { account: AccountHintProps }) {
  if (account.status === "loading") return null;
  if (account.status === "customer") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="checkout-account">
        <UserRoundCheckIcon className="size-4 shrink-0" aria-hidden />
        Pides con tu cuenta: lo verás en Mis pedidos.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground" data-testid="checkout-login">
      ¿Tienes cuenta?{" "}
      <Link href={account.loginHref} className="font-medium text-primary underline-offset-4 hover:underline">
        Ingresa para usar tus datos
      </Link>
    </p>
  );
}
