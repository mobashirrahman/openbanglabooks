import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Test-only access with the local service role (from .env.local): makes a
 * test account an editor, and removes the catalogue rows a test created.
 */
let client: SupabaseClient | null = null;
function service() {
  if (!client) {
    try {
      process.loadEnvFile(join(process.cwd(), ".env.local"));
    } catch {
      // variables may come from the environment instead
    }
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export async function makeEditor(email: string) {
  const sb = service();
  let user: { id: string } | undefined;
  for (let page = 1; !user; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    user = data.users.find((u) => u.email === email);
    if (data.users.length < 1000) break;
  }
  if (!user) throw new Error(`no user ${email}`);
  const { error: upErr } = await sb.from("profiles").update({ role: "editor" }).eq("id", user.id);
  if (upErr) throw upErr;
}

/** Deletes works, authors and stored files whose slugs start with the prefix. */
export async function removeTestCatalog(prefix: string) {
  const sb = service();
  const check = <T extends { error: unknown }>(r: T, what: string) => {
    if (r.error) throw new Error(`cleanup ${what}: ${JSON.stringify(r.error)}`);
    return r;
  };
  const { data: works } = check(await sb.from("works").select("id, editions(book_files(sha256))").like("slug", `${prefix}%`), "list");
  const shas = (works ?? []).flatMap((w) => (w.editions as { book_files: { sha256: string }[] }[]).flatMap((e) => e.book_files.map((f) => f.sha256)));
  if (shas.length) check(await sb.storage.from("books").remove(shas.map((s) => `${s}.epub`)), "files");
  check(await sb.from("works").delete().like("slug", `${prefix}%`), "works");
  check(await sb.from("authors").delete().like("slug", `${prefix}%`), "authors");
  check(await sb.from("genres").delete().like("slug", `${prefix}%`), "genres");
}

/** A small, valid EPUB 3 with two chapters; the token makes its contents (and hash) unique. */
export function testEpub(token: string, title = "পরীক্ষার বই") {
  const page = (h: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="bn" lang="bn"><head><title>${h}</title></head><body><h1>${h}</h1>${body}</body></html>`;
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [
      strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
      { level: 6 },
    ],
    "OEBPS/content.opf": [
      strToU8(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test:${token}</dc:identifier><dc:title>${title}</dc:title><dc:language>bn</dc:language><meta property="dcterms:modified">2026-11-05T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`),
      { level: 6 },
    ],
    "OEBPS/nav.xhtml": [
      strToU8(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>সূচি</title></head><body><nav epub:type="toc" id="toc"><ol><li><a href="c1.xhtml">প্রথম পরিচ্ছেদ</a></li><li><a href="c2.xhtml">দ্বিতীয় পরিচ্ছেদ</a></li></ol></nav></body></html>`),
      { level: 6 },
    ],
    "OEBPS/c1.xhtml": [strToU8(page("প্রথম পরিচ্ছেদ", `<p>নদীর ধারে একটি ছোট গ্রাম ছিল। ${token}</p>`.repeat(3))), { level: 6 }],
    "OEBPS/c2.xhtml": [strToU8(page("দ্বিতীয় পরিচ্ছেদ", "<p>সন্ধ্যা নামিল, আকাশে তারা ফুটিল।</p>".repeat(3))), { level: 6 }],
  };
  return Buffer.from(zipSync(files));
}
