// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders children as a span", () => {
    render(<Badge>Stable</Badge>);
    const badge = screen.getByText("Stable");
    expect(badge.tagName).toBe("SPAN");
  });

  it("applies the success variant when tone=success", () => {
    render(<Badge tone="success">Healthy</Badge>);
    const badge = screen.getByText("Healthy");
    expect(badge.className).toMatch(/ps-ok/);
  });

  it("explicit variant wins over tone", () => {
    render(
      <Badge tone="success" variant="destructive">
        Override
      </Badge>,
    );
    expect(screen.getByText("Override").className).toMatch(/ps-crit/);
  });

  it("forwards arbitrary props to the span", () => {
    render(
      <Badge data-testid="custom" aria-label="status">
        x
      </Badge>,
    );
    const badge = screen.getByTestId("custom");
    expect(badge).toHaveAttribute("aria-label", "status");
  });
});
