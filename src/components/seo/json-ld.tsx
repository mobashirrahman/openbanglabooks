/** Serialises Schema.org data safely into a script tag (escapes `<` to prevent breaking out). */
export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(Array.isArray(data) && data.length === 1 ? data[0] : data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
