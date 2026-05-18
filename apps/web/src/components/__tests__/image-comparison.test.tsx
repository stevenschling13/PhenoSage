// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ImageComparison } from "@/components/image-comparison";

describe("ImageComparison", () => {
  it("renders both frames with the supplied labels as alt + caption", () => {
    render(
      <ImageComparison
        plantId="plant-1"
        before={{
          imageId: "img-before",
          signedUrl: "https://example.com/before.png?token=initial",
          label: "Week 1",
        }}
        after={{
          imageId: "img-after",
          signedUrl: "https://example.com/after.png?token=initial",
          label: "Week 6",
        }}
      />,
    );

    const before = screen.getByAltText("Week 1") as HTMLImageElement;
    const after = screen.getByAltText("Week 6") as HTMLImageElement;
    expect(before.src).toBe("https://example.com/before.png?token=initial");
    expect(after.src).toBe("https://example.com/after.png?token=initial");
    expect(screen.getByText("Week 1").tagName).toBe("FIGCAPTION");
    expect(screen.getByText("Week 6").tagName).toBe("FIGCAPTION");
  });

  it("falls back to Before/After labels when none are supplied", () => {
    render(
      <ImageComparison
        plantId="plant-1"
        before={{
          imageId: "img-before",
          signedUrl: "https://example.com/before.png",
        }}
        after={{
          imageId: "img-after",
          signedUrl: "https://example.com/after.png",
        }}
      />,
    );

    expect(screen.getByAltText("Before")).toBeInTheDocument();
    expect(screen.getByAltText("After")).toBeInTheDocument();
  });
});
