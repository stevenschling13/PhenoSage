/**
 * Tiny class-name joiner. Filters falsy values and dedupes whitespace.
 * Avoids pulling in clsx/tailwind-merge as runtime dependencies.
 *
 * Supports strings, numbers, arrays, and `{ "class-name": boolean }` objects.
 * It does NOT resolve Tailwind conflicts — rely on intentional ordering when
 * overriding component styles via `className` props.
 */
export type ClassDict = { [key: string]: unknown };

export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassDict
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
      return;
    }
    if (typeof v === "object") {
      for (const key in v) {
        if (v[key]) out.push(key);
      }
    }
  };
  for (const v of inputs) walk(v);
  return out.join(" ").replace(/\s+/g, " ").trim();
}
