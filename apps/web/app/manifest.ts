import type { MetadataRoute } from "next";

/**
 * Web app manifest (installable PWA). Installing matters for push on iPhone: iOS only delivers web push to
 * apps added to the home screen (16.4+). There is no offline support: the service worker only shows pushes.
 * Colors: theme = --primary (orange-700), background = the app's stone background.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Munch Mate",
    short_name: "Munch Mate",
    description: "Pedidos para restaurantes: mesa, retiro y delivery.",
    lang: "es-CL",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#c2410c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
