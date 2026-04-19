import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ImageComparison } from "../image-comparison";

describe("ImageComparison Component", () => {
  const defaultProps = {
    beforeImage: "before.jpg",
    afterImage: "after.jpg",
    beforeLabel: "Old",
    afterLabel: "New",
  };

  it("renders correctly with provided images and labels", () => {
    render(<ImageComparison {...defaultProps} />);

    const beforeImg = screen.getByAltText("Old");
    const afterImg = screen.getByAltText("New");

    expect(beforeImg).toBeInTheDocument();
    expect(beforeImg).toHaveAttribute("src", "before.jpg");

    expect(afterImg).toBeInTheDocument();
    expect(afterImg).toHaveAttribute("src", "after.jpg");

    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("handles mouse interaction to change slider position", () => {
    render(<ImageComparison {...defaultProps} />);

    // The container is the first child of the render (or we can query by role/testId)
    // The component attaches mouse events to the main wrapper
    const container = screen.getByText("Old").closest("div.relative");
    expect(container).toBeInTheDocument();

    // Mock getBoundingClientRect
    if (container) {
      container.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
        right: 1000,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      // Simulate a click down in the middle of the container
      fireEvent.mouseDown(container, { clientX: 250 });
      // The initial state is 50%, moving to clientX 250 in a 1000px width should be 25%

      // We can verify the style of the clip-path element
      // It's the one wrapping the before image
      const clipWrapper = screen.getByAltText("Old").parentElement;
      expect(clipWrapper).toHaveStyle({ clipPath: "inset(0 75% 0 0)" });
    }
  });
});
