// Action-state contracts for createPlantAction. Lives in its own file
// because Next 16 enforces that any "use server" file may only export
// async functions. See ../grows/action-state.ts for the full rationale.

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
