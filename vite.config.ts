import { defineConfig } from "vite";
import vinext from "vinext";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  ssr: { external: ["@napi-rs/canvas", "node-readable-to-web-readable-stream"] },
  build: { rolldownOptions: { external: ["@napi-rs/canvas", "node-readable-to-web-readable-stream"] } },
  plugins: [
    vinext({ cache: { data: kvDataAdapter() } }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
