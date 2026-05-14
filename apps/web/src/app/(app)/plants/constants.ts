// Constants shared between the plants server action and the client form.
// Kept out of actions.ts because Next forbids non-async exports from a
// "use server" module.

// Bulk create cap. Anything larger should be a separate import flow —
// this keeps a single form submission predictable for both the user
// and Supabase (one round-trip, one insert payload).
export const MAX_BULK_PLANT_COUNT = 25;
