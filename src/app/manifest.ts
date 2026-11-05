import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenBanglaBooks — ওপেন বাংলা বুকস",
    short_name: "বাংলা বুকস",
    description: "বাংলা বইয়ের উন্মুক্ত পাঠাগার। Discover. Read. Remember.",
    lang: "bn",
    dir: "ltr",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F5EFE4",
    theme_color: "#233B30",
    categories: ["books", "education", "entertainment"],
    prefer_related_applications: false,
    // a second tap on the home-screen icon returns to the open app instead of a new window
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
    shortcuts: [
      { name: "আমার বই", short_name: "আমার বই", url: "/library", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "আমার নোট", short_name: "নোট", url: "/notes", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
