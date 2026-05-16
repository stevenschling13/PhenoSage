// Action-state contracts for createGrowAction. Lives in its own file
// because Next 16 enforces that any "use server" file may only export
// async functions — re-exporting a `const initialState` from
// `actions.ts` triggers `Error: A "use server" file can only export
// async functions, found object` at every POST. See
// https://nextjs.org/docs/messages/invalid-use-server-value.
//
// Types are erased at compile time so they're free to live in either
// file; we keep them next to the constant so consumers have one
// import for state + result shape.

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
