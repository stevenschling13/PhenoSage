// Action state lives outside actions.ts so the `"use server"` file can
// satisfy the React 19 / Next.js 16 contract: it must export only async
// functions. Constants and types stay here where both the server action
// implementation and the client forms can import them.

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
