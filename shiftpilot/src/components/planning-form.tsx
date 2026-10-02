"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, Clock3, Sparkles, Users } from "lucide-react";
import { createWeekAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { AnimatedIcon } from "@/components/animated-icon";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLES = [
  { label: "A normal week", icon: CalendarDays, goal: "Staff next week with the normal shift pattern." },
  { label: "Busier weekends", icon: Users, goal: "Staff next week. We're closed Monday, and weekend closing shifts need 3 people." },
  { label: "Fewer hours", icon: Clock3, goal: "Plan next week's roster, nobody over 24 hours because of exams." },
];

export function PlanningForm() {
  const [goal, setGoal] = useState("");
  return (
    <ActionForm action={createWeekAction} submitLabel="Plan my week" submitIcon={<AnimatedIcon icon={Sparkles} motion="pop" />} pendingLabel="Planning your week…" className="gap-5">
      <div className="grid gap-2.5">
        <Label htmlFor="week-goal">What do you need for the week?</Label>
        <Textarea id="week-goal" name="goal" rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="e.g. Staff next week, with 3 people on weekend closing shifts." required className="min-h-28 resize-y text-base leading-relaxed md:text-base" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-muted-foreground">Try an example</span>
        {EXAMPLES.map((example) => (
          <button key={example.label} type="button" onClick={() => setGoal(example.goal)} className="icon-trigger inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-background px-3 text-xs transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <AnimatedIcon icon={example.icon} className="size-3.5" />{example.label}<ArrowRight className="size-3" aria-hidden="true" />
          </button>
        ))}
      </div>
    </ActionForm>
  );
}
