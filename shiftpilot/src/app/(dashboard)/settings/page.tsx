import { Building2, ChevronDown, Clock3, FlaskConical, Layers3, Plug, Plus, RotateCcw, Save, Settings2, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import { connection } from "next/server";
import { applyPresetAction, resetDemoAction, saveSettingsAction } from "@/app/actions";
import { getWorkspace } from "@/agent/context";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AnimatedIcon } from "@/components/animated-icon";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { env, integrations } from "@/lib/env";
import { PRESETS } from "@/lib/presets";
import { DAY_SHORT } from "@/lib/time";
import type { ShiftTemplate } from "@/lib/types";

function Field({ name, label, defaultValue, type = "text", step, hint }: { name: string; label: string; defaultValue: string | number; type?: string; step?: string; hint?: string }) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} step={step} defaultValue={defaultValue} aria-describedby={hint ? `${name}-hint` : undefined} />
      {hint && <p id={`${name}-hint`} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Disclosure({ title, description, children, open = false, icon }: { title: string; description: string; children: React.ReactNode; open?: boolean; icon?: LucideIcon }) {
  return (
    <details open={open} className="rounded-xl border bg-card [&[open]>summary>svg]:rotate-180">
      <summary className="icon-trigger flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <span className="grid gap-1">
          <span className="inline-flex items-center gap-2 text-sm font-medium">{icon && <AnimatedIcon icon={icon} />}{title}</span>
          <span className="text-sm leading-relaxed text-muted-foreground">{description}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform" />
      </summary>
      <div className="border-t px-5 py-5">{children}</div>
    </details>
  );
}

function ShiftEditor({ template: t, index: i, newNumber }: { template: ShiftTemplate; index: number; newNumber?: number }) {
  const days = t.days.length === 7 ? "Every day" : t.days.map((day) => DAY_SHORT[day]).join(", ") || "No days selected";
  return (
    <Disclosure
      icon={Clock3}
      title={t.key ? t.label : `New shift type ${newNumber ?? i + 1}`}
      description={t.key ? `${t.start}–${t.end} · ${days} · ${t.requiredCount} ${t.requiredCount === 1 ? "person" : "people"}` : "Enter a label to add this shift type."}
      open={!t.key}
    >
      <input type="hidden" name={`t${i}_key`} defaultValue={t.key} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor={`t${i}_label`}>Shift label</Label>
          <Input id={`t${i}_label`} name={`t${i}_label`} defaultValue={t.label} placeholder={t.key ? undefined : "e.g. Morning"} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`t${i}_start`}>Start time</Label>
          <Input id={`t${i}_start`} name={`t${i}_start`} type="time" defaultValue={t.start} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`t${i}_end`}>End time</Label>
          <Input id={`t${i}_end`} name={`t${i}_end`} type="time" defaultValue={t.end} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`t${i}_count`}>People needed</Label>
          <Input id={`t${i}_count`} name={`t${i}_count`} type="number" min={1} defaultValue={t.requiredCount} />
        </div>
        <div className="grid gap-2 sm:col-span-2 lg:col-span-3">
          <Label htmlFor={`t${i}_skills`}>Required skills</Label>
          <Input id={`t${i}_skills`} name={`t${i}_skills`} defaultValue={t.requiredSkills.join(", ")} placeholder="Separate skills with commas" />
        </div>
        <fieldset className="min-w-0 sm:col-span-2 lg:col-span-4">
          <legend className="mb-2 text-sm font-medium">Days this shift runs</legend>
          <div className="flex flex-wrap gap-2">
            {DAY_SHORT.map((d, di) => (
              <label key={d} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-foreground/25 has-[:checked]:bg-muted/50">
                <input type="checkbox" name={`t${i}_days`} value={di} defaultChecked={t.days.includes(di)} className="size-4 accent-foreground" />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </Disclosure>
  );
}

const BLANK: ShiftTemplate = { key: "", label: "", start: "", end: "", days: [0, 1, 2, 3, 4, 5, 6], requiredCount: 1, requiredSkills: [] };

export default async function SettingsPage() {
  await connection();
  const ws = await getWorkspace();
  const status = [
    { name: "Postgres", ok: integrations.database, detail: "DATABASE_URL" },
    { name: "WhatsApp Cloud API", ok: integrations.whatsapp, detail: `phone number ID ${env.whatsapp.phoneNumberId ?? "not set"}, template "${env.whatsapp.templateName}"` },
    { name: "Webhook signature check", ok: Boolean(env.whatsapp.appSecret), detail: "WHATSAPP_APP_SECRET" },
    { name: "OpenRouter: Jev", ok: integrations.openrouter, detail: env.jevModel },
    { name: "OpenRouter: chat model", ok: integrations.openrouter, detail: env.llmModel },
    { name: "Google Sheets (optional)", ok: integrations.sheets, detail: env.sheets.spreadsheetId ?? "not configured" },
    { name: "Dashboard password", ok: Boolean(env.dashboardPassword), detail: "DASHBOARD_PASSWORD" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="grid gap-2">
        <h1 className="icon-trigger flex items-center gap-3 text-3xl font-medium tracking-tight"><AnimatedIcon icon={Settings2} motion="turn" className="size-5" />Settings</h1>
        <p className="text-muted-foreground">Set up your business, shifts and scheduling preferences.</p>
      </header>

      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {[{ id: "business", label: "Business", icon: Building2 }, { id: "shifts", label: "Shift types", icon: Clock3 }, { id: "rules", label: "Scheduling rules", icon: SlidersHorizontal }, { id: "advanced", label: "More settings", icon: Settings2 }].map(({ id, label, icon }) => (
          <a key={id} href={`#${id}`} className="icon-trigger inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><AnimatedIcon icon={icon} />{label}</a>
        ))}
      </nav>

      <ActionForm action={saveSettingsAction} submitLabel="Save settings" submitIcon={<AnimatedIcon icon={Save} motion="pop" />} pendingLabel="Saving settings…" className="gap-6">
        <Card id="business" className="scroll-mt-44 lg:scroll-mt-24">
          <CardHeader>
            <h2 className="icon-trigger inline-flex items-center gap-2 text-lg font-medium tracking-tight"><AnimatedIcon icon={Building2} />Business details</h2>
            <CardDescription>Your team sees this name in WhatsApp messages. Shift times follow your timezone.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field name="businessName" label="Business name" defaultValue={ws.businessName} />
            <Field name="timezone" label="Timezone" defaultValue={ws.timezone} hint="Use an IANA timezone, e.g. Asia/Singapore." />
            <Field name="skills" label="Team skills" defaultValue={ws.skills.join(", ")} hint="Separate skills with commas." />
          </CardContent>
        </Card>

        <Card id="shifts" className="scroll-mt-44 lg:scroll-mt-24">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="icon-trigger inline-flex items-center gap-2 text-lg font-medium tracking-tight"><AnimatedIcon icon={Clock3} motion="tilt" />Shift types</h2>
              <span className="text-xs text-muted-foreground">{ws.shiftTemplates.length} configured</span>
            </div>
            <CardDescription>Choose a shift to edit its hours, staffing and days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {ws.shiftTemplates.map((t, i) => <ShiftEditor key={t.key || i} template={t} index={i} />)}
            {ws.shiftTemplates.length === 0 && <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">No shift types yet. Add your first one below.</p>}
            <Disclosure icon={Plus} title="Add shift types" description="Add up to two new shift types, then save your settings.">
              <div className="flex flex-col gap-3">
                {[BLANK, BLANK].map((t, i) => <ShiftEditor key={i} template={t} index={ws.shiftTemplates.length + i} newNumber={i + 1} />)}
              </div>
            </Disclosure>
            <p className="text-xs leading-relaxed text-muted-foreground">Clear a shift label to remove it. A shift that ends before its start time runs overnight.</p>
          </CardContent>
        </Card>

        <Card id="rules" className="scroll-mt-44 lg:scroll-mt-24">
          <CardHeader>
            <h2 className="icon-trigger inline-flex items-center gap-2 text-lg font-medium tracking-tight"><AnimatedIcon icon={SlidersHorizontal} motion="tilt" />Scheduling rules</h2>
            <CardDescription>Keep hours manageable and decide how the agent follows up with your team.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-7">
            <fieldset>
              <legend className="mb-4 text-sm font-medium">Work limits</legend>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field name="maxHoursPerWeek" label="Max hours per week" type="number" defaultValue={ws.rules.maxHoursPerWeek} />
                <Field name="minRestHours" label="Rest between shifts (hours)" type="number" defaultValue={ws.rules.minRestHours} />
                <Field name="maxShiftsPerDay" label="Max shifts per day" type="number" defaultValue={ws.rules.maxShiftsPerDay} />
              </div>
            </fieldset>
            <fieldset className="border-t pt-6">
              <legend className="float-left mb-4 w-full text-sm font-medium">Requests and reminders</legend>
              <div className="clear-both grid gap-5 sm:grid-cols-2">
                <Field name="reminderAfterHours" label="Remind after (hours)" type="number" step="0.5" defaultValue={ws.rules.reminderAfterHours} />
                <Field name="maxReminders" label="Max reminders" type="number" defaultValue={ws.rules.maxReminders} />
                <Field name="availabilityDeadlineHours" label="Availability deadline (hours)" type="number" defaultValue={ws.rules.availabilityDeadlineHours} />
                <Field name="offerTimeoutMinutes" label="Offer timeout (minutes)" type="number" defaultValue={ws.rules.offerTimeoutMinutes} />
              </div>
            </fieldset>
            <label htmlFor="autoOffer" className="flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/30 p-4">
              <input id="autoOffer" type="checkbox" name="autoOffer" defaultChecked={ws.autoOfferReplacements} className="mt-0.5 size-4 shrink-0 accent-foreground" />
              <span className="grid gap-1">
                <span className="text-sm font-medium">Automatically offer replacement shifts</span>
                <span className="text-sm leading-relaxed text-muted-foreground">Pre-approve offers within everyone&apos;s hour limit. Overtime still needs your approval.</span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Disclosure icon={Clock3} title="Time saved estimates" description="Adjust the manual effort baselines used to estimate how much time the agent saves.">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field name="minutesPerMessageSent" label="Per message sent (minutes)" type="number" step="0.1" defaultValue={ws.baselines.minutesPerMessageSent} />
            <Field name="minutesPerReplyRead" label="Per reply read (minutes)" type="number" step="0.1" defaultValue={ws.baselines.minutesPerReplyRead} />
            <Field name="minutesToBuildRoster" label="Build a roster (minutes)" type="number" defaultValue={ws.baselines.minutesToBuildRoster} />
            <Field name="minutesPerCoverCall" label="Per cover request (minutes)" type="number" step="0.1" defaultValue={ws.baselines.minutesPerCoverCall} />
            <Field name="minutesPerApproval" label="Per approval (minutes)" type="number" step="0.1" defaultValue={ws.baselines.minutesPerApproval} />
          </div>
        </Disclosure>
        <p className="text-sm text-muted-foreground">Changes apply to newly planned weeks.</p>
      </ActionForm>

      <section id="advanced" aria-labelledby="advanced-title" className="grid scroll-mt-44 gap-3 border-t pt-8 lg:scroll-mt-24">
        <h2 id="advanced-title" className="icon-trigger mb-1 inline-flex items-center gap-2 text-lg font-medium tracking-tight"><AnimatedIcon icon={Settings2} motion="turn" />More settings</h2>
        <Disclosure icon={Plug} title="Integrations" description="Check the services connected to your workspace.">
          <ul className="divide-y">
            {status.map((s) => (
              <li key={s.name} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                <div className="min-w-0 grid gap-1">
                  <span className="text-sm font-medium">{s.name}</span>
                  <span className="break-all text-xs leading-relaxed text-muted-foreground">{s.detail}</span>
                </div>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{s.ok ? "Connected" : "Off"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 break-all rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">Webhook URL: <code>https://&lt;your-tunnel&gt;/api/whatsapp/webhook</code></p>
        </Disclosure>

        <Disclosure icon={Layers3} title="Business presets" description="Replace your shift types and skills with a starting template.">
          <div className="grid gap-4 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <form key={p.key} action={applyPresetAction} className="flex flex-col items-start gap-4 rounded-xl border p-4">
                <input type="hidden" name="preset" value={p.key} />
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {p.name}
                    {ws.presetKey === p.key && <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">Current</span>}
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">{p.description}</p>
                </div>
                <SubmitButton size="sm" variant="outline" className="icon-trigger mt-auto" aria-label={`Apply ${p.name} preset`}><AnimatedIcon icon={Sparkles} motion="pop" />Apply preset</SubmitButton>
              </form>
            ))}
          </div>
        </Disclosure>

        <Disclosure icon={FlaskConical} title="Demo tools" description="Clear test activity while keeping your workers and settings.">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">Resetting clears weeks, messages, approvals and the audit log. Your workers and business settings are kept.</p>
            <form action={resetDemoAction}>
              <SubmitButton size="sm" variant="destructive" className="icon-trigger"><AnimatedIcon icon={RotateCcw} motion="turn" />Reset demo data</SubmitButton>
            </form>
          </div>
        </Disclosure>
      </section>
    </div>
  );
}
