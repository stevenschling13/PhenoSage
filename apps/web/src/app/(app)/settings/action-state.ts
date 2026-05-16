// Action-state contracts for the Settings page actions. Lives in its
// own file because Next 16 enforces that any "use server" file may
// only export async functions — exporting a `const initialState` from
// `actions.ts` triggers `Error: A "use server" file can only export
// async functions, found object` at every POST. See
// https://nextjs.org/docs/messages/invalid-use-server-value.

export type UpdateDisplayNameActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const updateDisplayNameActionInitialState: UpdateDisplayNameActionResult =
  {
    status: "idle",
  };

export type UpdateTimezoneActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const updateTimezoneActionInitialState: UpdateTimezoneActionResult = {
  status: "idle",
};

export type UpdateEmailPreferencesActionResult = {
  message?: string;
  status: "error" | "idle" | "success";
};

export const updateEmailPreferencesActionInitialState: UpdateEmailPreferencesActionResult =
  {
    status: "idle",
  };
