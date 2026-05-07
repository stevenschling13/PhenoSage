import { describe, expect, it } from "vitest";
import { cn } from "../cn";

describe("cn", () => {
  it("returns an empty string when nothing is passed", () => {
    expect(cn()).toBe("");
  });

  it("joins simple string classes with single spaces", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("filters out falsy values (null, undefined, false, '')", () => {
    expect(cn("a", null, undefined, false, "", "b")).toBe("a b");
  });

  it("keeps the literal value 0 (number)", () => {
    // Documented behavior: numbers including 0 are preserved.
    expect(cn("a", 0, "b")).toBe("a 0 b");
  });

  it("flattens nested arrays recursively", () => {
    expect(cn(["a", ["b", ["c", null], "d"], "e"])).toBe("a b c d e");
  });

  it("includes object keys whose values are truthy", () => {
    expect(cn({ foo: true, bar: false, baz: 1, qux: 0 })).toBe("foo baz");
  });

  it("merges strings, arrays, and objects in one call", () => {
    expect(cn("a", { b: true, c: false }, ["d", { e: 1 }])).toBe("a b d e");
  });

  it("collapses consecutive whitespace from input strings", () => {
    expect(cn("a   b", "  c  ")).toBe("a b c");
  });

  it("trims leading and trailing whitespace", () => {
    expect(cn("  a", "b  ")).toBe("a b");
  });

  it("does not deduplicate repeated class names", () => {
    // The util explicitly does not resolve Tailwind conflicts; doc'd behavior.
    expect(cn("a", "a", "b")).toBe("a a b");
  });
});
