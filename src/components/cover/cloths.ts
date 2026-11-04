/** Cover cloths and their foil; also used for quote cards. */
export const CLOTHS = [
  { cloth: "#233B30", foil: "#C9A971" }, // forest
  { cloth: "#6B3328", foil: "#D7B27A" }, // madder
  { cloth: "#26324A", foil: "#C9A971" }, // indigo
  { cloth: "#A27A43", foil: "#2A2117" }, // turmeric, ink-stamped
  { cloth: "#2C302E", foil: "#C2A06C" }, // charcoal
  { cloth: "#4D2A34", foil: "#D2AE78" }, // lac
] as const;

/** The cloth and foil of a book's cover. */
export const clothOf = (variant: number) => CLOTHS[Math.abs(variant) % CLOTHS.length];
