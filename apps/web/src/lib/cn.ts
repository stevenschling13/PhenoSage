/**
 * Tiny class-name joiner. Filters falsy values and dedupes whitespace.
 * Avoids pulling in clsx/tailwind-merge as runtime dependencies.
 */
export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (!v && v !== 0) return;
    if (typeof v === "string" || typeof v === "number") {
      out.push(String(v));
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
    }
  };
  for (const v of inputs) walk(v);
  return out.join(" ").replace(/\s+/g, " ").trim();
}
