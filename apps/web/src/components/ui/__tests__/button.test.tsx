// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, buttonStyles } from "@/components/ui/button";

describe("Button", () => {
  it("renders as a <button type='button'> by default and forwards children", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("respects an explicit type override", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("invokes onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Click me" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled and aria-busy while loading", () => {
    render(<Button loading>Loading</Button>);
    const btn = screen.getByRole("button", { name: "Loading" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Disabled" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders leftIcon when not loading and swaps in spinner when loading", () => {
    const Icon = () => <svg data-testid="left-icon" />;
    const { rerender } = render(<Button leftIcon={<Icon />}>Action</Button>);
    expect(screen.getByTestId("left-icon")).toBeInTheDocument();

    rerender(
      <Button loading leftIcon={<Icon />}>
        Action
      </Button>,
    );
    expect(screen.queryByTestId("left-icon")).not.toBeInTheDocument();
  });

  it("renders rightIcon when not loading and hides it while loading", () => {
    const Icon = () => <svg data-testid="right-icon" />;
    const { rerender } = render(<Button rightIcon={<Icon />}>Action</Button>);
    expect(screen.getByTestId("right-icon")).toBeInTheDocument();

    rerender(
      <Button loading rightIcon={<Icon />}>
        Action
      </Button>,
    );
    expect(screen.queryByTestId("right-icon")).not.toBeInTheDocument();
  });

  it("asChild clones the child and forwards classes", () => {
    render(
      <Button asChild variant="secondary">
        <a href="/dashboard">Dashboard</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Dashboard" });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(link.className).toMatch(/rounded-full/);
  });

  it("asChild throws when given non-element children", () => {
    expect(() => render(<Button asChild>{"plain string"}</Button>)).toThrow();
  });

  it("buttonStyles composes variant + size + className", () => {
    const className = buttonStyles({
      variant: "destructive",
      size: "lg",
      className: "custom-class",
    });
    expect(className).toContain("custom-class");
    expect(className).toMatch(/rounded-full/);
  });
});
