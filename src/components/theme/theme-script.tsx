/**
 * Sets data-theme on <html> before first paint so the page never flashes the
 * wrong theme. Preference ("light" | "dark" | "system") lives in localStorage.
 * Kept tiny and dependency-free; it is inlined into the document head.
 */
export const THEME_STORAGE_KEY = "obb:theme";

export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){}})();`;

export function ThemeScript({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />;
}
