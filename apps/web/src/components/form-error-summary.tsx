"use client";

import { useEffect, useRef } from "react";

export interface FormErrorSummaryProps {
  /** Top-level form error (e.g. "Could not save grow."). */
  message?: string | null | undefined;
  /** Map of field name → error message, as returned by server actions. */
  fieldErrors?: Record<string, string | undefined> | undefined;
  /**
   * Map of field name → human label and target element id, used to render
   * the deep-link list. Field names not present here are skipped.
   */
  fieldMeta?: Record<string, { label: string; targetId: string }> | undefined;
  /** Element id; defaults to "form-error-summary". */
  id?: string | undefined;
}

/**
 * Accessible form error summary. Renders nothing when there are no errors.
 *
 * When errors appear, the summary:
 * - takes focus so screen readers announce it,
 * - exposes role="alert" + aria-live="assertive",
 * - lists each field error as a link to the offending field.
 */
export function FormErrorSummary({
  message,
  fieldErrors,
  fieldMeta,
  id = "form-error-summary",
}: FormErrorSummaryProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const entries = fieldErrors
    ? Object.entries(fieldErrors).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].length > 0,
      )
    : [];

  const hasErrors = Boolean(message) || entries.length > 0;

  useEffect(() => {
    if (hasErrors) {
      ref.current?.focus();
    }
  }, [hasErrors, message, entries.length]);

  if (!hasErrors) {
    return null;
  }

  const heading =
    message && message.length > 0
      ? message
      : "Please fix the errors below and try again.";

  return (
    <div
      ref={ref}
      id={id}
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      className="rounded-[1.15rem] border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
    >
      <p className="font-semibold">{heading}</p>
      {entries.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {entries.map(([name, errorMessage]) => {
            const meta = fieldMeta?.[name];
            if (!meta) {
              return <li key={name}>{errorMessage}</li>;
            }
            return (
              <li key={name}>
                <a
                  href={`#${meta.targetId}`}
                  className="underline underline-offset-2 hover:text-danger/80"
                >
                  {meta.label}: {errorMessage}
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
