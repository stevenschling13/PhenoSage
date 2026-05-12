// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";

function installMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  installMatchMedia(false);
});

describe("ThemeToggle", () => {
  it("renders three radio options after hydration", async () => {
    render(<ThemeToggle />);
    // skeleton renders synchronously; wait for effect
    await screen.findByRole("radiogroup", { name: /color theme/i });
    expect(
      screen.getByRole("radio", { name: /light theme/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /match system theme/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /dark theme/i }),
    ).toBeInTheDocument();
  });

  it("defaults to 'system' when nothing is persisted", async () => {
    render(<ThemeToggle />);
    const systemRadio = await screen.findByRole("radio", {
      name: /match system theme/i,
    });
    expect(systemRadio).toHaveAttribute("aria-checked", "true");
  });

  it("hydrates from localStorage", async () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeToggle />);
    const darkRadio = await screen.findByRole("radio", {
      name: /dark theme/i,
    });
    expect(darkRadio).toHaveAttribute("aria-checked", "true");
  });

  it("clicking 'Dark theme' persists to localStorage and adds .dark class", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const darkRadio = await screen.findByRole("radio", { name: /dark theme/i });
    await user.click(darkRadio);
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("clicking 'Match system' clears the persisted theme", async () => {
    const user = userEvent.setup();
    localStorage.setItem("theme", "dark");
    render(<ThemeToggle />);
    const systemRadio = await screen.findByRole("radio", {
      name: /match system theme/i,
    });
    await user.click(systemRadio);
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("ArrowRight key cycles selection and focuses the next option", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const lightRadio = await screen.findByRole("radio", {
      name: /light theme/i,
    });
    await act(async () => {
      lightRadio.focus();
    });
    await user.keyboard("{ArrowRight}");
    const systemRadio = screen.getByRole("radio", {
      name: /match system theme/i,
    });
    expect(systemRadio).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(systemRadio);
  });
});
