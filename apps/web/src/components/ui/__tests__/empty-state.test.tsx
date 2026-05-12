// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("renders the title as a heading", () => {
    render(<EmptyState title="No plants yet" />);
    expect(
      screen.getByRole("heading", { name: "No plants yet" }),
    ).toBeInTheDocument();
  });

  it("renders description and action when provided", () => {
    render(
      <EmptyState
        title="Empty"
        description="Add your first plant to begin."
        action={<button type="button">Add plant</button>}
      />,
    );
    expect(
      screen.getByText("Add your first plant to begin."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add plant" }),
    ).toBeInTheDocument();
  });

  it("hides decorative icon from assistive tech", () => {
    render(<EmptyState title="Empty" icon={<svg data-testid="icon" />} />);
    // The icon's wrapper carries aria-hidden so screen readers skip it.
    const icon = screen.getByTestId("icon");
    expect(icon.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("does not render description / action when omitted", () => {
    render(<EmptyState title="Bare" />);
    expect(screen.queryByText("Bare")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
