// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import { ErrorFallback } from "@/components/error-fallback";

const consoleSpy = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);
afterEach(() => {
  consoleSpy.mockClear();
});

describe("ErrorFallback", () => {
  it("renders default eyebrow / title / description / dashboard link", () => {
    render(<ErrorFallback />);
    expect(screen.getByText("Unexpected error")).toBeInTheDocument();
    // Title carries role="alert" (set explicitly) so screen readers announce it.
    expect(screen.getByRole("alert")).toHaveTextContent(
      /something stopped working/i,
    );
    const link = screen.getByRole("link", { name: "Open dashboard" });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("supports custom copy and secondary link", () => {
    render(
      <ErrorFallback
        eyebrow="Assistant error"
        title="The grow copilot is unavailable right now."
        description="Try again in a minute."
        secondaryHref="/plants"
        secondaryLabel="Back to plants"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /the grow copilot is unavailable/i,
    );
    expect(screen.getByText("Try again in a minute.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to plants" }),
    ).toHaveAttribute("href", "/plants");
  });

  it("renders the try-again button only when reset is provided and invokes it", async () => {
    const reset = vi.fn();
    const { rerender } = render(<ErrorFallback />);
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();

    rerender(<ErrorFallback reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("surfaces the digest reference when present", () => {
    const error = Object.assign(new Error("boom"), { digest: "DGST-42" });
    render(<ErrorFallback error={error} />);
    expect(screen.getByText(/reference code:/i)).toBeInTheDocument();
    expect(screen.getByText("DGST-42")).toBeInTheDocument();
  });

  it("logs the error to console.error for observability", () => {
    const error = Object.assign(new Error("boom"), { digest: "DGST-1" });
    render(<ErrorFallback error={error} />);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[error-boundary]",
      expect.objectContaining({ message: "boom", digest: "DGST-1" }),
    );
  });
});
