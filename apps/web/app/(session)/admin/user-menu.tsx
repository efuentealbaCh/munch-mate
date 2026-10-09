"use client";

import type { UserProfile } from "@app/types";
import { ChevronDownIcon, LogOutIcon, ShieldIcon, StoreIcon } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Up to two initials for the avatar ("Ana María Pérez" → "AM"). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function UserMenu({ user, onLogout }: { user: UserProfile; onLogout: () => void | Promise<void> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2" aria-label={`Menú de ${user.name}`}>
          <Avatar>
            <AvatarFallback className="bg-brand-soft text-xs font-semibold text-brand-soft-foreground">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{user.name}</span>
          <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate font-medium text-foreground">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Only platform admins see it; the api answers 404 to everyone else anyway. */}
        {user.platformRole === "admin" ? (
          <>
            <DropdownMenuItem asChild className="min-h-10">
              <Link href="/admin">
                <StoreIcon aria-hidden />
                Mis restaurantes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="min-h-10">
              <Link href="/plataforma">
                <ShieldIcon aria-hidden />
                Plataforma
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem className="min-h-10" onSelect={() => void onLogout()}>
          <LogOutIcon aria-hidden />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
