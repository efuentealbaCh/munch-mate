import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Munch Mate", template: "%s · Munch Mate" },
  description: "Pedidos para restaurantes: mesa, retiro y delivery.",
  // Installed on an iPhone home screen (required there for push notifications): full screen, our name.
  appleWebApp: { capable: true, title: "Munch Mate", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#c2410c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CL">
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
