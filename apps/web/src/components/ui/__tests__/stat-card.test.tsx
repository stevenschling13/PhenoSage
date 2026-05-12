// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "@/components/ui/stat-card";

describe("StatCard", () => {
  it("renders label, value, and detail copy", () => {
    render(
      <StatCard
        label="Healthy plants"
        value="12"
        detail="Up from 10 yesterday."
      />,
    );
    expect(screen.getByText("Healthy plants")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Up from 10 yesterday.")).toBeInTheDocument();
  });

  it("renders icon and meta slots when provided", () => {
    render(
      <StatCard
        label="Alerts"
        value="3"
        detail="Triage them in /alerts."
        icon={<svg data-testid="icon" />}
        meta={<span data-testid="meta">trending</span>}
      />,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByTestId("meta")).toBeInTheDocument();
  });

  it("omits meta block when no meta provided", () => {
    render(<StatCard label="x" value="1" detail="y" />);
    expect(screen.queryByTestId("meta")).not.toBeInTheDocument();
  });
});
