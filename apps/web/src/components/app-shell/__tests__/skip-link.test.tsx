// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkipLink } from "@/components/app-shell/skip-link";

describe("SkipLink", () => {
  it("renders a link to #main-content by default", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toHaveAttribute("href", "#main-content");
  });

  it("honors a custom target href", () => {
    render(<SkipLink href="#chat" />);
    expect(
      screen.getByRole("link", { name: /skip to main content/i }),
    ).toHaveAttribute("href", "#chat");
  });
});
