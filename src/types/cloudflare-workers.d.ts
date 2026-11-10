/**
 * Minimal typing for the Workers runtime module that vinext externalises for
 * the Cloudflare build. Bindings are declared in cloudflare.config.ts.
 */
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
