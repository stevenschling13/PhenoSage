// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The form pulls in server actions through "./actions"; stub them with
// inert no-ops so React's useActionState has something to call.
vi.mock("../actions", () => ({
  signInAction: vi.fn(async () => null),
  signUpAction: vi.fn(async () => null),
  signInWithOtpAction: vi.fn(async () => null),
}));

import { SignInForm } from "@/app/auth/sign-in-form";

describe("SignInForm", () => {
  it("renders three tabs and exposes accessible names", () => {
    render(<SignInForm />);
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Sign up" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "Magic link" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("renders the sign-in tabpanel with email and password fields", () => {
    render(<SignInForm />);
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("clicking 'Sign up' tab activates the sign-up panel", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.click(screen.getByRole("tab", { name: "Sign up" }));
    expect(screen.getByRole("tab", { name: "Sign up" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
  });

  it("Magic link tab hides the password field", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.click(screen.getByRole("tab", { name: "Magic link" }));
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send magic link/i }),
    ).toBeInTheDocument();
  });

  it("ArrowRight on the tablist cycles selection", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    const signInTab = screen.getByRole("tab", { name: "Sign in" });
    signInTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Sign up" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders an assertive alert when initialError is supplied", () => {
    render(<SignInForm initialError="Your session expired." />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Your session expired.");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    // Auto-focus for screen-reader announcement (WORKLOG 2026-05-08).
    expect(document.activeElement).toBe(alert);
  });

  it("Cross-tab CTA 'Create an account' switches to sign-up", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.click(
      screen.getByRole("button", { name: /create an account/i }),
    );
    expect(screen.getByRole("tab", { name: "Sign up" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
