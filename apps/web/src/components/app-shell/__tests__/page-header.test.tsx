// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "@/components/app-shell/page-header";

describe("PageHeader (app-shell)", () => {
  it("renders title as an <h1>", () => {
    render(<PageHeader title="Dashboard" />);
    const heading = screen.getByRole("heading", {
      name: "Dashboard",
      level: 1,
    });
    expect(heading).toBeInTheDocument();
  });

  it("renders eyebrow, description, and actions when supplied", () => {
    render(
      <PageHeader
        eyebrow="Workspace"
        title="Dashboard"
        description="Operator overview"
        actions={<button type="button">New plant</button>}
      />,
    );
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Operator overview")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New plant" }),
    ).toBeInTheDocument();
  });

  it("omits eyebrow / description / actions when not provided", () => {
    const { container } = render(<PageHeader title="Bare" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
