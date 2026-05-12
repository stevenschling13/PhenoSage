// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormErrorSummary } from "@/components/form-error-summary";

describe("FormErrorSummary", () => {
  it("renders nothing when there are no errors", () => {
    const { container } = render(<FormErrorSummary />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the top-level message as an assertive alert and focuses itself", () => {
    render(<FormErrorSummary message="Could not save grow." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not save grow.");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(alert);
  });

  it("falls back to a generic heading when only field errors are present", () => {
    render(
      <FormErrorSummary
        fieldErrors={{ name: "Required" }}
        fieldMeta={{ name: { label: "Grow name", targetId: "grow-name" } }}
      />,
    );
    expect(
      screen.getByText(/please fix the errors below/i),
    ).toBeInTheDocument();
  });

  it("renders field errors as deep-link anchors when meta is provided", () => {
    render(
      <FormErrorSummary
        message="Fix the form."
        fieldErrors={{ name: "Required", stage: "Pick a stage" }}
        fieldMeta={{
          name: { label: "Grow name", targetId: "grow-name" },
          stage: { label: "Stage", targetId: "grow-stage" },
        }}
      />,
    );
    const nameLink = screen.getByRole("link", {
      name: /grow name: required/i,
    });
    expect(nameLink).toHaveAttribute("href", "#grow-name");
    const stageLink = screen.getByRole("link", {
      name: /stage: pick a stage/i,
    });
    expect(stageLink).toHaveAttribute("href", "#grow-stage");
  });

  it("renders plain <li> text when no meta entry exists for a field", () => {
    render(<FormErrorSummary fieldErrors={{ mystery: "broken" }} />);
    expect(screen.getByText("broken")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("skips undefined / empty field errors", () => {
    render(
      <FormErrorSummary
        message="Heads up"
        fieldErrors={{
          name: undefined,
          stage: "",
          medium: "Pick a medium",
        }}
        fieldMeta={{
          medium: { label: "Medium", targetId: "grow-medium" },
        }}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/medium: pick a medium/i)).toBeInTheDocument();
  });
});
