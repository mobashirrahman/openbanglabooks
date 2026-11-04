export type LiteraryForm = "novel" | "short-stories" | "poetry" | "essays" | "drama";

export type AuthorRef = {
  slug: string;
  name_bn: string;
  name_en: string;
};

export type Author = AuthorRef & {
  born_year: number | null;
  died_year: number | null;
  bio_bn: string | null;
  bio_en: string | null;
  wikidata_id: string | null;
  wikisource_url: string | null;
};

export type GenreRef = { slug: string; name_bn: string; name_en: string };
export type Genre = GenreRef & { description_bn: string | null; description_en: string | null; count: number };

export type WorkSummary = {
  slug: string;
  title_bn: string;
  subtitle_bn: string | null;
  title_en: string;
  original_pub_year: number | null;
  form: LiteraryForm;
  literary_period: string | null;
  cover_variant: number;
  featured_rank: number | null;
  created_at: string;
  authors: AuthorRef[];
  genres: GenreRef[];
};

export type TocEntry = { label: string; href: string; children?: TocEntry[] };

export type Edition = {
  id: string;
  label_bn: string | null;
  label_en: string | null;
  publisher: string | null;
  pub_year: number | null;
  source_name: string;
  source_url: string;
  license: string;
  license_url: string | null;
  attribution: string | null;
  toc: TocEntry[];
  excerpt_bn: string | null;
  chapter_count: number | null;
};

export type BookFile = { sha256: string; bytes: number; storage_path: string };

export type WorkDetail = WorkSummary & {
  description_bn: string | null;
  description_en: string | null;
  rights_basis: string | null;
  collections: { slug: string; name_bn: string; name_en: string }[];
  edition: Edition | null;
  file: BookFile | null;
};

export type Collection = {
  slug: string;
  name_bn: string;
  name_en: string;
  description_bn: string | null;
  description_en: string | null;
  works: WorkSummary[];
};
