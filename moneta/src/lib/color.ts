/**
 * Couleurs de marque fournies par des tiers (ex. couleur d'une banque chez Powens) : certaines sont trop pâles
 * pour afficher un texte blanc ou une icône lisible. On les assombrit progressivement jusqu'à un contraste suffisant.
 */
function parse(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Renvoie une couleur sur laquelle un texte blanc reste lisible (contraste ≥ 4,5:1), en gardant la teinte. */
export function readableColor(hex: string | null | undefined, fallback = "#2a78d6"): string {
  const rgb = hex ? parse(hex) : null;
  if (!rgb) return fallback;
  let cur = rgb;
  for (let i = 0; i < 20 && (1.05 / (luminance(cur) + 0.05)) < 4.5; i++) cur = cur.map((v) => Math.round(v * 0.85)) as [number, number, number];
  return `#${cur.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
