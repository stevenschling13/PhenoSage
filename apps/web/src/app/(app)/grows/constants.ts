// Constants shared between the grows server actions (new + [id]).
// Kept out of actions.ts because Next forbids non-async exports from a
// "use server" module.

// DB column is unbounded `text`; cap here to keep list views renderable
// and lock out paste-bomb fat-fingers. Mirrors the chat tool's
// MAX_NOTES_LENGTH so both create paths agree on prose size.
export const MAX_DESCRIPTION_LENGTH = 2_000;

// Past start dates are allowed (data-entry catch-up is the common
// case); the future side is clamped to one day to lock out year-9999
// fat-fingers.
export const MAX_FUTURE_START_MS = 24 * 60 * 60 * 1000;
