/**
 * The reader page's HTML starts the book's download with a tiny inline script
 * (earlyBookScript), seconds before the reader's code has loaded on a slow
 * phone network, and leaves it on `window[EARLY_BOOK]` as `{ url, res }`: a
 * promise of the response, null when the network failed. The reader takes it
 * over once, in loadEpubBytes.
 *
 * A book already kept on the device needs no download, but IndexedDB is too
 * slow to ask before the page has even arrived: a short list in localStorage
 * names the books kept (a hint only — if it is wrong, the reader simply
 * fetches or reads the book itself, as before). A plain module: the server
 * page and the client both use it.
 */
export const EARLY_BOOK = "__obbEarlyBook";
const HERE_KEY = "obb:books-here";
const HERE_MAX = 300;

export type EarlyBook = { url: string; res: Promise<Response | null> };

const short = (sha256: string) => sha256.slice(0, 12);

/** The inline script for the reader page (its nonce is the page's). */
export function earlyBookScript(url: string, sha256: string) {
  return `(function(){var u=${JSON.stringify(url)},h="";try{h=" "+(localStorage.getItem(${JSON.stringify(HERE_KEY)})||"")+" "}catch(e){}if(h.indexOf(" ${short(sha256)} ")>=0)return;try{window.${EARLY_BOOK}={url:u,res:fetch(u).catch(function(){return null})}}catch(e){}})();`;
}

/** The download already under way for `url`, taken over at most once; null if there is none. */
export function takeEarlyBook(url: string): Promise<Response | null> | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, EarlyBook | undefined>;
  const early = w[EARLY_BOOK];
  if (!early || early.url !== url) return null;
  delete w[EARLY_BOOK];
  return early.res;
}

/** Notes that this book is now kept on the device (the newest last; the oldest fall off). */
export function markBookHere(sha256: string) {
  try {
    const list = (localStorage.getItem(HERE_KEY) ?? "").split(" ").filter((s) => s && s !== short(sha256));
    list.push(short(sha256));
    localStorage.setItem(HERE_KEY, list.slice(-HERE_MAX).join(" "));
  } catch {
    /* storage unavailable: the page just downloads the book early, as it would anyway */
  }
}

/** The device was emptied. */
export function forgetBooksHere() {
  try {
    localStorage.removeItem(HERE_KEY);
  } catch {
    /* private mode */
  }
}
