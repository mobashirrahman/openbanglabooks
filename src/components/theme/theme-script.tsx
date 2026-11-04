/**
 * Sets data-theme on <html> before first paint so the page never flashes the
 * wrong theme. Preference ("light" | "dark" | "system") lives in localStorage.
 * Also flags data-reading when there is local reading progress, so the
 * Continue Reading slot reserves its space before hydration (no layout shift).
 * Kept tiny and dependency-free; it is inlined into the document head.
 */
export const THEME_STORAGE_KEY = "obb:theme";

export const themeInitScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";if(localStorage.getItem("obb:has-progress"))r.setAttribute("data-reading","");}catch(e){}})();`;

export function ThemeScript({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />;
}
