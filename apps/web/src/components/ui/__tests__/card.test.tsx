// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

describe("Card primitives", () => {
  it("composes header / title / description / content / footer", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Plant overview</CardTitle>
          <CardDescription>Last analyzed yesterday</CardDescription>
        </CardHeader>
        <CardContent>
          <p>Body</p>
        </CardContent>
        <CardFooter>
          <button type="button">Action</button>
        </CardFooter>
      </Card>,
    );

    expect(
      screen.getByRole("heading", { name: "Plant overview" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Last analyzed yesterday")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
  });

  it("merges custom className with base classes", () => {
    render(
      <Card className="custom-card" data-testid="card">
        ok
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(card.className).toContain("custom-card");
    expect(card.className).toMatch(/rounded-/);
  });

  it("applies the accent variant", () => {
    render(
      <Card variant="accent" data-testid="card">
        ok
      </Card>,
    );
    expect(screen.getByTestId("card").className).toMatch(/ps-accent-soft/);
  });
});
