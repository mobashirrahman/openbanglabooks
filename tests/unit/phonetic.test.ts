import { describe, expect, it } from "vitest";
import { likeness, skeleton, skeletons } from "@/lib/transfer/phonetic";

const same = (...xs: string[]) => {
  const keys = xs.map((x) => skeletons(x).join(" "));
  expect(new Set(keys).size, `${xs.join(" / ")} → ${keys.join(" / ")}`).toBe(1);
};

describe("phonetic skeletons", () => {
  it("match Bengali script with its romanisations", () => {
    same("দেবদাস", "Devdas", "Debdas", "Debdash");
    same("শ্রীকান্ত", "Srikanta", "Srikanto", "Shrikanta");
    same("গীতাঞ্জলি", "Gitanjali", "Geetanjali", "Gitanjoli");
    same("গল্পগুচ্ছ", "Galpaguchchha", "Golpoguccho", "Galpaguccha");
    same("আনন্দমঠ", "Anandamath", "Anondomoth");
    same("কপালকুণ্ডলা", "Kapalkundala", "Kopalkundola");
    same("শেষের কবিতা", "Shesher Kobita", "Shesher Kabita");
    same("পথের পাঁচালী", "Pather Panchali");
    same("চতুরঙ্গ", "Chaturanga", "Choturongo");
    same("বাংলা", "Bangla");
    same("যোগাযোগ", "Yogayog");
    same("মায়া", "Maya", "Maaya");
    same("বিশ্বাস", "Biswas", "Bishwas");
    same("কৃষ্ণ", "Krishna");
    same("পাহাড়", "Pahar");
  });

  it("match names, including surnames spelt two ways", () => {
    same("রবীন্দ্রনাথ ঠাকুর", "Rabindranath Tagore", "Robindronath Thakur");
    same("শরৎচন্দ্র চট্টোপাধ্যায়", "Saratchandra Chattopadhyay", "Sharatchandra Chatterjee");
    same("বিভূতিভূষণ বন্দ্যোপাধ্যায়", "Bibhutibhushan Bandyopadhyay", "Bibhutibhushan Banerjee", "Bibhutibhushan Bandopadhyay");
    same("উপেন্দ্রকিশোর রায়চৌধুরী", "Upendrakishore Raychowdhury", "Upendrokishor Roychoudhury");
  });

  it("keep a word that starts with a vowel apart from one that does not", () => {
    expect(skeleton("Ananda")).not.toBe(skeleton("Nanda"));
    expect(skeleton("আনন্দ")).toBe(skeleton("Ananda"));
  });

  it("read words run together as the same name", () => {
    expect(likeness(skeletons("Sarat Chandra Chattopadhyay"), skeletons("শরৎচন্দ্র চট্টোপাধ্যায়"))).toBe(1);
    expect(likeness(skeletons("Palli Samaj"), skeletons("Pallisamaj"))).toBe(1);
    expect(likeness(skeletons("Bankim Chandra Chattopadhyay"), skeletons("Sarat Chandra Chattopadhyay"))).toBeLessThan(0.75);
  });
});
