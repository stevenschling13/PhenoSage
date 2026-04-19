import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssistantWorkspace } from "../assistant-workspace";

describe("AssistantWorkspace Component", () => {
  beforeEach(() => {
    // Reset fetch mock before each test
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: {
          getReader: () => {
            let done = false;
            return {
              read: () => {
                if (!done) {
                  done = true;
                  return Promise.resolve({
                    done: false,
                    value: new TextEncoder().encode("Test response"),
                  });
                }
                return Promise.resolve({ done: true });
              },
            };
          },
        },
      }),
    ) as any;
  });

  it("renders the initial welcome message", () => {
    render(<AssistantWorkspace />);

    // Check if the welcome message is rendered
    expect(screen.getByText(/I am PhenoSage Copilot/)).toBeInTheDocument();

    // Check if suggested prompts are rendered
    expect(
      screen.getByText(
        "Turn a yellowing leaf report into a daily action checklist.",
      ),
    ).toBeInTheDocument();
  });

  it("disables submit button when input is empty", () => {
    render(<AssistantWorkspace />);

    const submitBtn = screen.getByRole("button", { name: /Send to copilot/i });
    expect(submitBtn).toBeDisabled();
  });

  it("calls fetch with prompt when a suggested prompt is clicked", async () => {
    render(<AssistantWorkspace />);

    const promptText =
      "What does PhenoSage need to compare nutrient drift over time?";
    const promptBtn = screen.getByText(promptText);
    fireEvent.click(promptBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(promptText),
        }),
      );
    });
  });
});
