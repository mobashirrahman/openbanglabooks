-- Reference data: literary forms as browseable genres, and curated shelves.
-- Works, authors and editions are added by the ingestion pipeline
-- (pnpm ingest), never by hand-written SQL.

insert into public.genres (slug, name_bn, name_en, description_bn, description_en, position) values
  ('upanyas', 'উপন্যাস', 'Novels', 'দীর্ঘ কাহিনি, চরিত্র ও সময়ের বিস্তৃত ছবি।', 'Long-form fiction.', 1),
  ('chhotogolpo', 'ছোটগল্প', 'Short stories', 'অল্প কথায় গভীর জীবনের মুহূর্ত।', 'Short fiction.', 2),
  ('kobita', 'কবিতা', 'Poetry', 'গান, গীতিকবিতা ও মহাকাব্য।', 'Lyric and epic poetry.', 3),
  ('probondho', 'প্রবন্ধ', 'Essays', 'চিন্তা, সমাজ ও সাহিত্য নিয়ে লেখা।', 'Essays and non-fiction prose.', 4),
  ('shishu', 'ছোটদের বই', 'For children', 'রূপকথা, লোককথা আর ছড়া — ছোটদের জন্য লেখা।', 'Folk tales and stories written for children.', 5);

insert into public.collections (slug, name_bn, name_en, description_bn, description_en, position) values
  ('classics', 'বাংলা সাহিত্যের ক্লাসিক', 'Classics of Bengali literature', 'যে বইগুলো বাংলা গদ্য ও কবিতার পথ বদলে দিয়েছে।', 'Books that changed Bengali prose and poetry.', 1),
  ('rabindranath', 'রবীন্দ্রনাথ ঠাকুর', 'Rabindranath Tagore', 'উপন্যাস, গল্প ও গান — রবীন্দ্রনাথের লেখা।', 'Novels, stories and songs by Tagore.', 2),
  ('saratchandra', 'শরৎচন্দ্র চট্টোপাধ্যায়', 'Sarat Chandra Chattopadhyay', 'গ্রামবাংলার মানুষ ও তাদের সম্পর্কের কাহিনিকার।', 'The storyteller of rural Bengal.', 3),
  ('bankimchandra', 'বঙ্কিমচন্দ্র চট্টোপাধ্যায়', 'Bankim Chandra Chattopadhyay', 'আধুনিক বাংলা উপন্যাসের ভিত্তি গড়েছিলেন যিনি।', 'The founder of the modern Bengali novel.', 4);
