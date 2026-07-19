import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "home — personal command center",
    short_name: "home",
    description: "Your work, context, and AI agents in one calm place.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    orientation: "any",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
