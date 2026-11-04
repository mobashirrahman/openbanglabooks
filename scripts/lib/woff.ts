import { inflateSync } from "node:zlib";

/**
 * Converts a WOFF 1.0 file into a plain sfnt (TTF/OTF) buffer so it can be
 * loaded by HarfBuzz, which does not decode WOFF itself.
 * Spec: https://www.w3.org/TR/WOFF/
 */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (view.getUint32(0) !== 0x774f4646) throw new Error("Not a WOFF 1.0 file");
  const flavor = view.getUint32(4);
  const numTables = view.getUint16(12);
  const totalSfntSize = view.getUint32(16);

  const out = new Uint8Array(totalSfntSize);
  const o = new DataView(out.buffer);
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  o.setUint32(0, flavor);
  o.setUint16(4, numTables);
  o.setUint16(6, searchRange);
  o.setUint16(8, entrySelector);
  o.setUint16(10, numTables * 16 - searchRange);

  let offset = 12 + numTables * 16;
  for (let i = 0; i < numTables; i++) {
    const e = 44 + i * 20;
    const tag = view.getUint32(e);
    const tableOffset = view.getUint32(e + 4);
    const compLength = view.getUint32(e + 8);
    const origLength = view.getUint32(e + 12);
    const checksum = view.getUint32(e + 16);
    const raw = woff.subarray(tableOffset, tableOffset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : raw;
    if (data.byteLength !== origLength) throw new Error("WOFF table length mismatch");

    const d = 12 + i * 16;
    o.setUint32(d, tag);
    o.setUint32(d + 4, checksum);
    o.setUint32(d + 8, offset);
    o.setUint32(d + 12, origLength);
    out.set(data, offset);
    offset += (origLength + 3) & ~3; // 4-byte alignment
  }
  return out;
}
