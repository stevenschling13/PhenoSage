// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : String(src)} />
  ),
}));

import { ImageComparison } from "@/components/image-comparison";

describe("ImageComparison", () => {
  it("renders both frames with default labels", () => {
    render(
      <ImageComparison
        beforeImage="https://example.com/before.png"
        afterImage="https://example.com/after.png"
      />,
    );
    const before = screen.getByAltText("Before");
    const after = screen.getByAltText("After");
    expect(before).toHaveAttribute("src", "https://example.com/before.png");
    expect(after).toHaveAttribute("src", "https://example.com/after.png");
  });

  it("renders custom labels and uses them as captions", () => {
    render(
      <ImageComparison
        beforeImage="/a.png"
        afterImage="/b.png"
        beforeLabel="Week 1"
        afterLabel="Week 6"
      />,
    );
    expect(screen.getByAltText("Week 1")).toBeInTheDocument();
    expect(screen.getByText("Week 1").tagName).toBe("FIGCAPTION");
    expect(screen.getByText("Week 6").tagName).toBe("FIGCAPTION");
  });
});
