// Action-state contracts for the grow-detail page actions. Lives in
// its own file because Next 16 enforces that any "use server" file may
// only export async functions. See ../action-state.ts for the full
// rationale.

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
