// Action state lives outside actions.ts so the `"use server"` file can
// satisfy the React 19 / Next.js 16 contract: it must export only async
// functions. Constants and types stay here where both the server action
// implementation and the client form can import them.

export type CreatePlantActionResult = {
  fieldErrors?: {
    count?: string;
    growId?: string;
    name?: string;
  };
  message?: string;
  redirectTo?: string;
  status: "error" | "idle" | "success";
};

export const createPlantActionInitialState: CreatePlantActionResult = {
  status: "idle",
};
