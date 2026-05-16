// Action state lives outside actions.ts so the `"use server"` file can
// satisfy the React 19 / Next.js 16 contract: it must export only async
// functions. Constants and types stay here where both the server action
// implementation and the client form can import them.

export type CreateGrowActionResult = {
  fieldErrors?: {
    description?: string;
    lightType?: string;
    medium?: string;
    name?: string;
    stage?: string;
    startDate?: string;
    targetHarvestDate?: string;
  };
  message?: string;
  redirectTo?: string;
  status: "error" | "idle" | "success";
};

export const createGrowActionInitialState: CreateGrowActionResult = {
  status: "idle",
};
