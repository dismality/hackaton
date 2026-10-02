"use client";

import { useActionState } from "react";
import { setupAnswerAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Wraps one onboarding question. Choice buttons can submit on their own by setting name="value". */
export function StepForm({
  step,
  children,
  submitLabel = "Continue",
  hideSubmit,
  enterHint = true,
}: {
  step: string;
  children: React.ReactNode;
  submitLabel?: string;
  hideSubmit?: boolean;
  enterHint?: boolean;
}) {
  const [state, action, pending] = useActionState(setupAnswerAction, null);
  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="step" value={step} />
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {!hideSubmit && (
        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" disabled={pending} className="h-11 px-5 text-base">
            {pending ? "Saving…" : submitLabel}
          </Button>
          {enterHint && <span className="text-xs text-muted-foreground">or press Enter</span>}
        </div>
      )}
      {hideSubmit && pending && <p className="text-sm text-muted-foreground">Saving…</p>}
    </form>
  );
}
