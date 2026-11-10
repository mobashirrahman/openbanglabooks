/**
 * Parsing and validation of the admin forms. Pure functions over FormData,
 * shared by the server actions (the trust boundary) and their tests. Errors
 * are codes, turned into words by the form in the editor's language.
 */

export type FieldError = "required" | "slug" | "year" | "years" | "number" | "url" | "tooLong" | "wikidata" | "credits" | "choice";
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, FieldError> };

export const STATUSES = ["draft", "published", "withdrawn"] as const;
export const FORMS = ["novel", "short-stories", "poetry", "essays", "drama"] as const;
export const ROLES = ["author", "translator", "editor", "illustrator"] as const;
export const COVER_VARIANTS = 36;
export type Status = (typeof STATUSES)[number];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THIS_YEAR = () => new Date().getUTCFullYear();

class Reader {
  errors: Record<string, FieldError> = {};
  constructor(private fd: FormData) {}

  raw(name: string) {
    const v = this.fd.get(name);
    return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  }
  text(name: string, { required = false, max = 200 } = {}): string | null {
    const v = this.raw(name);
    if (!v) {
      if (required) this.errors[name] = "required";
      return null;
    }
    if ([...v].length > max) this.errors[name] = "tooLong";
    return v;
  }
  slug(name: string) {
    const v = this.raw(name).toLowerCase();
    if (!v) this.errors[name] = "required";
    else if (!SLUG.test(v) || v.length > 80) this.errors[name] = "slug";
    return v;
  }
  int(name: string, { min, max, required = false, error = "number" as FieldError }: { min: number; max: number; required?: boolean; error?: FieldError }) {
    const v = toAscii(this.raw(name));
    if (!v) {
      if (required) this.errors[name] = "required";
      return null;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      this.errors[name] = error;
      return null;
    }
    return n;
  }
  year(name: string, required = false) {
    return this.int(name, { min: 1000, max: THIS_YEAR(), required, error: "year" });
  }
  url(name: string, required = false) {
    const v = this.raw(name);
    if (!v) {
      if (required) this.errors[name] = "required";
      return null;
    }
    try {
      const u = new URL(v);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    } catch {
      this.errors[name] = "url";
    }
    if (v.length > 500) this.errors[name] = "tooLong";
    return v;
  }
  choice<T extends string>(name: string, options: readonly T[]): T {
    const v = this.raw(name) as T;
    if (!options.includes(v)) this.errors[name] = "choice";
    return v;
  }
  bool(name: string) {
    return this.fd.get(name) === "on" || this.fd.get(name) === "true";
  }
  ids(name: string) {
    return [...new Set(this.fd.getAll(name).filter((v): v is string => typeof v === "string" && UUID.test(v)))];
  }
  id(name: string) {
    const v = this.raw(name);
    return UUID.test(v) ? v : null;
  }
  result<T>(value: T): Parsed<T> {
    return Object.keys(this.errors).length ? { ok: false, errors: this.errors } : { ok: true, value };
  }
}

/** Bengali digits typed into number fields count as digits. */
function toAscii(s: string) {
  return s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
}

export type WorkInput = {
  id: string | null;
  slug: string;
  title_bn: string;
  title_en: string;
  title_latn: string;
  subtitle_bn: string | null;
  original_pub_year: number | null;
  form: (typeof FORMS)[number];
  literary_period: string | null;
  description_bn: string | null;
  description_en: string | null;
  status: Status;
  featured_rank: number | null;
  cover_variant: number;
  authors: { id: string; role: (typeof ROLES)[number] }[];
  genres: string[];
  collections: string[];
};

export function parseWork(fd: FormData): Parsed<WorkInput> {
  const r = new Reader(fd);
  const authorIds = fd.getAll("author_id").map(String);
  const authorRoles = fd.getAll("author_role").map(String);
  const seen = new Set<string>();
  const authors: WorkInput["authors"] = [];
  authorIds.forEach((id, i) => {
    const role = (ROLES as readonly string[]).includes(authorRoles[i]) ? (authorRoles[i] as WorkInput["authors"][number]["role"]) : "author";
    if (!UUID.test(id) || seen.has(`${id}:${role}`)) return;
    seen.add(`${id}:${role}`);
    authors.push({ id, role });
  });
  if (!authors.some((a) => a.role === "author")) r.errors.authors = "credits";

  const value: WorkInput = {
    id: r.id("id"),
    slug: r.slug("slug"),
    title_bn: r.text("title_bn", { required: true }) ?? "",
    title_en: r.text("title_en", { required: true }) ?? "",
    title_latn: r.text("title_latn", { required: true }) ?? "",
    subtitle_bn: r.text("subtitle_bn"),
    original_pub_year: r.year("original_pub_year"),
    form: r.choice("form", FORMS),
    literary_period: r.text("literary_period", { max: 80 }),
    description_bn: r.text("description_bn", { max: 5000 }),
    description_en: r.text("description_en", { max: 5000 }),
    status: r.choice("status", STATUSES),
    featured_rank: r.int("featured_rank", { min: 1, max: 999 }),
    cover_variant: r.int("cover_variant", { min: 0, max: COVER_VARIANTS - 1 }) ?? 0,
    authors,
    genres: r.ids("genre"),
    collections: r.ids("collection"),
  };
  return r.result(value);
}

export type AuthorInput = {
  id: string | null;
  slug: string;
  name_bn: string;
  name_en: string;
  born_year: number | null;
  died_year: number | null;
  bio_bn: string | null;
  bio_en: string | null;
  wikidata_id: string | null;
  wikisource_url: string | null;
  status: Status;
};

export function parseAuthor(fd: FormData): Parsed<AuthorInput> {
  const r = new Reader(fd);
  const value: AuthorInput = {
    id: r.id("id"),
    slug: r.slug("slug"),
    name_bn: r.text("name_bn", { required: true }) ?? "",
    name_en: r.text("name_en", { required: true }) ?? "",
    born_year: r.year("born_year"),
    died_year: r.year("died_year"),
    bio_bn: r.text("bio_bn", { max: 5000 }),
    bio_en: r.text("bio_en", { max: 5000 }),
    wikidata_id: r.text("wikidata_id", { max: 20 }),
    wikisource_url: r.url("wikisource_url"),
    status: r.choice("status", STATUSES),
  };
  if (value.wikidata_id && !/^Q\d+$/.test(value.wikidata_id)) r.errors.wikidata_id = "wikidata";
  if (value.born_year && value.died_year && value.died_year < value.born_year) r.errors.died_year = "years";
  return r.result(value);
}

export type EditionInput = {
  id: string | null;
  work_id: string | null;
  label_bn: string | null;
  label_en: string | null;
  publisher: string | null;
  pub_year: number | null;
  source_name: string;
  source_url: string;
  license: string;
  license_url: string | null;
  attribution: string | null;
  is_primary: boolean;
  status: Status;
};

export function parseEdition(fd: FormData): Parsed<EditionInput> {
  const r = new Reader(fd);
  const value: EditionInput = {
    id: r.id("id"),
    work_id: r.id("work_id"),
    label_bn: r.text("label_bn"),
    label_en: r.text("label_en"),
    publisher: r.text("publisher"),
    pub_year: r.year("pub_year"),
    source_name: r.text("source_name", { required: true }) ?? "",
    source_url: r.url("source_url", true) ?? "",
    license: r.text("license", { required: true, max: 100 }) ?? "",
    license_url: r.url("license_url"),
    attribution: r.text("attribution", { max: 1000 }),
    is_primary: r.bool("is_primary"),
    status: r.choice("status", STATUSES),
  };
  if (!value.id && !value.work_id) r.errors.work_id = "required";
  return r.result(value);
}

export type TermInput = {
  id: string | null;
  slug: string;
  name_bn: string;
  name_en: string;
  description_bn: string | null;
  description_en: string | null;
  position: number;
  status: Status | null;
};

/** A genre or a collection (collections also have a status). */
export function parseTerm(fd: FormData, withStatus: boolean): Parsed<TermInput> {
  const r = new Reader(fd);
  const value: TermInput = {
    id: r.id("id"),
    slug: r.slug("slug"),
    name_bn: r.text("name_bn", { required: true, max: 100 }) ?? "",
    name_en: r.text("name_en", { required: true, max: 100 }) ?? "",
    description_bn: r.text("description_bn", { max: 2000 }),
    description_en: r.text("description_en", { max: 2000 }),
    position: r.int("position", { min: 0, max: 100000 }) ?? 0,
    status: withStatus ? r.choice("status", STATUSES) : null,
  };
  return r.result(value);
}
