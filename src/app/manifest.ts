import type { MetadataRoute } from "next";
import { appDescription, catalogTitle } from "@/lib/config";
import { withBase } from "@/lib/utils";

/**
 * The web app manifest, served at /manifest.webmanifest and linked from every
 * page by Next. It names the app when someone installs it or adds it to a
 * home screen. Without one, the browser falls back to whatever it last saw on
 * the origin, and the origin can be shared: in dev with any other app on the
 * same localhost port, in production with the other apps under one domain.
 *
 * Next doesn't add the base path to anything in here, so every URL goes
 * through withBase. Colors are the canvas and surface tokens from globals.css.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: withBase("/"),
    name: catalogTitle,
    short_name: catalogTitle,
    description: appDescription,
    start_url: withBase("/"),
    scope: withBase("/"),
    display: "standalone",
    background_color: "#e3e8ed",
    theme_color: "#ffffff",
    icons: [
      { src: withBase("/icons/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: withBase("/icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: withBase("/icons/icon-512-maskable.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
