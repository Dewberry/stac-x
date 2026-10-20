"use client";

import { useState, type ReactNode } from "react";
import { envMeta, nextEnv, type EnvKey } from "@/lib/env";
import { qcMeta, type QcStatus } from "@/lib/stac";

/**
 * The parts the Admin review sheet is made of: decision cards that say what
 * each choice will do, the line under the button that says what saving
 * writes, and the history folded into a row at the end.
 */

export type Decision = Exclude<QcStatus, "pending">;

export const DECISIONS: Decision[] = ["approved", "needs_revision", "rejected"];

/** The words for a decision in one environment, for one collection or several. */
export function decisionCopy(env: EnvKey, decision: QcStatus | null, count = 1) {
  const next = nextEnv(env);
  const here = envMeta(env).label;
  const toProd = decision === "approved" && next?.key === "prod";
  const choices: { value: Decision; label: string; hint: string }[] = [
    {
      value: "approved",
      label: "Approve",
      hint: next
        ? `Sends a copy to ${next.label}, where it starts unreviewed. Today is recorded as the approval date.`
        : envMeta(env).onPath
          ? "Marks it approved. Production is the last step. Today is recorded as the approval date."
          : `Marks it approved. ${here} is outside promotion, so nothing is copied. Today is recorded as the approval date.`,
    },
    {
      value: "needs_revision",
      label: "Needs revision",
      hint:
        next?.key === "prod"
          ? "It stays in Test, blocked, until a fixed version is approved in Development and sent again."
          : "It stays here until a fixed version comes in.",
    },
    { value: "rejected", label: "Reject", hint: "It stays here and won't move forward." },
  ];
  const n = count > 1 ? ` ${count} collections` : "";
  const submit =
    decision === "approved"
      ? next
        ? `Approve${n} and send to ${next.label}`
        : `Approve${n}`
      : decision === "needs_revision"
        ? `Mark${n} as needs revision`
        : decision === "rejected"
          ? `Reject${n}`
          : decision === "pending"
            ? "Reset to Not reviewed"
            : "Choose a decision";
  const consequence =
    decision === null
      ? "Pick a decision above. Nothing is written until you do."
      : decision === "approved" && next
        ? `Writes the QC record beside the source file and copies the ${count > 1 ? "collections" : "collection"} to ${next.label}.`
        : `Writes the QC record in ${here}. Nothing moves.`;
  const placeholder = toProd
    ? "What was checked, and why it's ready for Production."
    : decision === "approved" || decision === null
      ? "What was checked."
      : "What's wrong, so whoever fixes it knows where to look.";
  return { next, toProd, choices, submit, consequence, placeholder };
}

/**
 * The three decisions as full-width cards. Picked, a card takes its state's
 * color; unpicked, none of them show green, amber or red, so the colors only
 * ever mean a decision someone made.
 */
export function DecisionCards({
  name,
  choices,
  decision,
  onPick,
  disabled,
}: {
  name: string;
  choices: { value: Decision; label: string; hint: string }[];
  decision: QcStatus | null;
  onPick: (d: Decision) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="sx-choices">
      <legend className="sx-choices-legend">
        <span>Decision</span>
      </legend>
      {choices.map((c) => (
        <div key={c.value} className="sx-choice" data-tone={qcMeta(c.value).tone}>
          <label className="sx-choice-hit">
            <input
              type="radio"
              name={name}
              value={c.value}
              checked={decision === c.value}
              onChange={() => onPick(c.value)}
              disabled={disabled}
            />
            <span className="sx-choice-label">{c.label}</span>
            <span className="sx-choice-hint">{c.hint}</span>
          </label>
        </div>
      ))}
    </fieldset>
  );
}

/** History as the last row of a review: a summary line that opens in place. */
export function HistoryRow({ label = "History", summary, children }: { label?: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sx-history-row" data-open={open || undefined}>
      <button type="button" className="sx-history-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Caret />
        <b>{label}</b>
        <span className="ffx-num">{summary}</span>
      </button>
      {open && <div className="sx-history-body">{children}</div>}
    </div>
  );
}

export function Caret() {
  return (
    <svg className="sx-caret" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path d="M3 1.5 7 5l-4 3.5z" fill="currentColor" />
    </svg>
  );
}
