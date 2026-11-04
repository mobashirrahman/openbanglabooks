import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // API routes are not pages; personal, search and reader pages are crawlable but marked noindex
        disallow: ["/api/"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
