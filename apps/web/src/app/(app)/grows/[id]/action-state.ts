// Action state lives outside actions.ts so the `"use server"` file can
// satisfy the React 19 / Next.js 16 contract: it must export only async
// functions. Constants and types stay here where both the server action
// implementation and the client forms can import them.

export type ToggleArchiveActionResult = {
  message?: string;
  redirectTo?: string;
  status: "error" | "idle" | "success";
};

export const toggleArchiveActionInitialState: ToggleArchiveActionResult = {
  status: "idle",
};

export type UpdateGrowActionResult = {
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

export const updateGrowActionInitialState: UpdateGrowActionResult = {
  status: "idle",
};

export type AdvanceGrowStageActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const advanceGrowStageActionInitialState: AdvanceGrowStageActionResult =
  {
    status: "idle",
  };

export type DeleteGrowActionResult = {
  message?: string;
  redirectTo?: string;
  status: "error" | "idle" | "success";
};

export const deleteGrowActionInitialState: DeleteGrowActionResult = {
  status: "idle",
};
