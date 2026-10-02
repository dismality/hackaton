"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  submitIcon?: React.ReactNode;
  pendingLabel?: string;
  resetOnSuccess?: boolean;
  className?: string;
  children: React.ReactNode;
};

/** A form bound to a server action that reports errors and success messages inline. */
export function ActionForm({ action, submitLabel, submitIcon, pendingLabel, resetOnSuccess, className, children }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} data-pending={pending ? "true" : undefined} className={cn("flex flex-col gap-3", className)}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="icon-trigger">
          {!pending && submitIcon}
          {pending ? (pendingLabel ?? "Working…") : submitLabel}
        </Button>
        {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        {state?.message && <p role="status" className="text-sm text-muted-foreground">{state.message}</p>}
      </div>
    </form>
  );
}

/** Submit button for plain server-action forms; shows a pending state while the action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" {...props} disabled={pending || props.disabled}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}
