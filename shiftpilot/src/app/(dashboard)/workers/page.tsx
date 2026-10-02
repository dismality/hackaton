import { desc } from "drizzle-orm";
import { ChevronDown, FlaskConical, MessageSquare, Send, UserRoundPlus, Users } from "lucide-react";
import { connection } from "next/server";
import { addWorkerAction, deleteWorkerAction, seedWorkersAction, simulateMessageAction, toggleWorkerAction } from "@/app/actions";
import { getWorkspace } from "@/agent/context";
import { getDb, schema } from "@/db";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AnimatedIcon } from "@/components/animated-icon";
import { AutoRefresh } from "@/components/auto-refresh";
import { WorkersDirectory } from "@/components/workers-directory";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { integrations } from "@/lib/env";
import { formatDateTime } from "@/lib/time";

const SAMPLE_MESSAGES = [
  "can do mornings mon-wed, not fri. weekends anything",
  "free all week except thursday evening",
  "sorry cant come tmr, got fever",
  "ok I can take it",
  "no sorry busy",
];

const disclosureSummary = "icon-trigger flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-6 [&::-webkit-details-marker]:hidden";

export default async function WorkersPage() {
  await connection();
  const db = getDb();
  const ws = await getWorkspace();
  const workers = await db.select().from(schema.workers).orderBy(schema.workers.simulated, schema.workers.id);
  const messages = await db.select().from(schema.messages).orderBy(desc(schema.messages.id)).limit(40);
  const nameOf = new Map(workers.map((w) => [w.id, w.name]));
  const activeCount = workers.filter((w) => w.active).length;
  const simulatedCount = workers.filter((w) => w.simulated).length;

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh seconds={6} />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="icon-trigger flex items-center gap-3 text-3xl font-medium tracking-tight"><AnimatedIcon icon={Users} motion="lift" className="size-5" />Team</h1>
          <p className="text-muted-foreground">Manage your people, their skills and their weekly hours.</p>
          <p className="text-sm text-muted-foreground">{workers.length} members <span aria-hidden="true">·</span> {activeCount} active <span aria-hidden="true">·</span> {simulatedCount} simulated</p>
        </div>
        <a href="#team-messages" className="icon-trigger inline-flex min-h-10 items-center gap-2 self-start rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><AnimatedIcon icon={MessageSquare} motion="pop" />View messages</a>
      </header>

      <details className="group rounded-xl border bg-card">
        <summary className={disclosureSummary}>
          <span className="inline-flex items-center gap-2 font-medium"><AnimatedIcon icon={UserRoundPlus} motion="pop" />Add worker</span>
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t px-5 py-6 sm:px-6">
          <p className="mb-6 text-sm text-muted-foreground">Add their contact details and any scheduling limits.</p>
          <ActionForm action={addWorkerAction} submitLabel="Add worker" submitIcon={<AnimatedIcon icon={UserRoundPlus} motion="pop" />} resetOnSuccess className="gap-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="worker-name">Name</Label>
                <Input id="worker-name" name="name" autoComplete="name" placeholder="e.g. Aisha Tan" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="worker-phone">WhatsApp number</Label>
                <Input id="worker-phone" name="phone" type="tel" autoComplete="tel" placeholder="+65 9123 4567" aria-describedby="worker-phone-hint" />
                <p id="worker-phone-hint" className="text-xs text-muted-foreground">Include the country code. Meta test numbers require an allowed recipient.</p>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Skills</legend>
                <div className="flex flex-wrap gap-2">
                  {ws.skills.map((skill) => (
                    <label key={skill} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm hover:bg-muted/50">
                      <input type="checkbox" name="skills" value={skill} className="size-4 accent-primary" />{skill}
                    </label>
                  ))}
                  {ws.skills.length === 0 && <p className="text-sm text-muted-foreground">No skills configured yet.</p>}
                </div>
              </fieldset>
              <div className="grid content-start gap-2">
                <Label htmlFor="worker-max-hours">Max hours per week</Label>
                <Input id="worker-max-hours" name="maxHours" type="number" min={1} placeholder={String(ws.rules.maxHoursPerWeek)} aria-describedby="worker-hours-hint" />
                <p id="worker-hours-hint" className="text-xs text-muted-foreground">Leave blank to use your {ws.rules.maxHoursPerWeek}-hour default.</p>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input type="checkbox" name="simulated" className="mt-0.5 size-4 accent-primary" />
              <span className="grid gap-1"><span className="font-medium">Simulated worker</span><span className="text-muted-foreground">For demos. No phone or WhatsApp messages needed.</span></span>
            </label>
          </ActionForm>
        </div>
      </details>

      <section aria-label="Team directory" className="flex flex-col gap-4">
        {!integrations.whatsapp && (
          <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">WhatsApp isn&apos;t connected yet. Messages to real workers are simulated until it&apos;s configured.</p>
        )}
        <WorkersDirectory items={workers.map((worker) => ({
          id: worker.id,
          name: worker.name,
          phone: worker.phone,
          skills: worker.skills,
          active: worker.active,
          simulated: worker.simulated,
          content: (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">{worker.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words font-medium">{worker.name}</h2>
                      {!worker.active && <Badge variant="secondary">Inactive</Badge>}
                      {worker.simulated && <Badge variant="outline">Simulated</Badge>}
                    </div>
                    <p className="break-words text-sm text-muted-foreground">{worker.skills.join(", ") || "No specific skills"}</p>
                  </div>
                </div>
                <details className="group/member">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden" aria-label={`Manage ${worker.name}`}>
                    Manage<ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open/member:rotate-180" />
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form action={toggleWorkerAction}>
                      <input type="hidden" name="id" value={worker.id} />
                      <SubmitButton size="sm" variant="outline" className="h-9" aria-label={`${worker.active ? "Deactivate" : "Activate"} ${worker.name}`}>{worker.active ? "Deactivate" : "Activate"}</SubmitButton>
                    </form>
                    <form action={deleteWorkerAction}>
                      <input type="hidden" name="id" value={worker.id} />
                      <SubmitButton size="sm" variant="destructive" className="h-9" aria-label={`Delete ${worker.name}`}>Delete</SubmitButton>
                    </form>
                  </div>
                </details>
              </div>
              <dl className="grid gap-4 text-sm sm:grid-cols-3 sm:pl-13">
                <div className="grid gap-1"><dt className="text-xs text-muted-foreground">WhatsApp</dt><dd className="break-words tabular-nums">{worker.phone ? `+${worker.phone}` : "No number"}</dd></div>
                <div className="grid gap-1"><dt className="text-xs text-muted-foreground">Weekly limit</dt><dd>{worker.maxHoursPerWeek ?? ws.rules.maxHoursPerWeek} hours</dd></div>
                <div className="grid gap-1"><dt className="text-xs text-muted-foreground">Last message</dt><dd>{worker.lastInboundAt ? formatDateTime(worker.lastInboundAt.getTime(), ws.timezone) : "No messages yet"}</dd></div>
              </dl>
            </div>
          ),
        }))} />
      </section>

      <Card id="team-messages" className="scroll-mt-44 lg:scroll-mt-24">
        <CardHeader>
          <CardTitle><h2 className="icon-trigger inline-flex items-center gap-2"><AnimatedIcon icon={MessageSquare} motion="pop" />Messages</h2></CardTitle>
          <CardDescription>The latest 40 messages, including replies and delivery status.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="region" aria-label="Recent team messages" tabIndex={0} className="flex max-h-[32rem] flex-col gap-4 overflow-y-auto rounded-lg pr-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.direction === "out" ? "justify-end" : ""}`}>
                <div className={`w-fit max-w-[95%] rounded-xl border px-4 py-3 text-sm sm:max-w-[85%] ${message.direction === "out" ? "bg-muted/60" : "bg-background"}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{message.direction === "out" ? "To" : "From"} {nameOf.get(message.workerId ?? 0) ?? message.phone}</span>
                    <span>{formatDateTime(message.createdAt.getTime(), ws.timezone)}</span>
                    <Badge variant="outline" className="text-xs">{message.status.replace(/_/g, " ")}</Badge>
                  </div>
                  {typeof message.payload?.image === "string" && (
                    <a href={message.payload.image} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={message.payload.image} alt="Roster image" className="mb-3 w-full max-w-sm rounded-lg ring-1 ring-foreground/10" />
                    </a>
                  )}
                  <div className="whitespace-pre-line break-words leading-relaxed">{message.body}</div>
                  {message.understanding && "intent" in message.understanding && <p className="mt-2 text-xs text-muted-foreground">Read as {String(message.understanding.intent)} ({String(message.understanding.via)})</p>}
                  {message.error && <p className="mt-2 text-xs text-destructive">{message.error}</p>}
                </div>
              </div>
            ))}
            {messages.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Messages will appear here when your team starts replying.</p>}
          </div>
        </CardContent>
      </Card>

      <details className="group rounded-xl border">
        <summary className={disclosureSummary}>
          <span className="grid gap-1"><span className="inline-flex items-center gap-2 text-sm font-medium"><AnimatedIcon icon={FlaskConical} motion="tilt" />Demo tools</span><span className="text-sm text-muted-foreground">Add simulated staff or test a worker reply.</span></span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-8 border-t px-5 py-6 sm:px-6 lg:grid-cols-[1fr_2fr]">
          <div className="flex flex-col items-start gap-4">
            <div className="grid gap-2"><h2 className="text-sm font-medium">Simulated staff</h2><p className="text-sm text-muted-foreground">Fill out the roster for a demo. These workers reply automatically and never receive WhatsApp messages.</p></div>
            <form action={seedWorkersAction}><SubmitButton variant="outline" className="icon-trigger"><AnimatedIcon icon={UserRoundPlus} motion="pop" />Add simulated workers</SubmitButton></form>
          </div>
          <div className="flex flex-col gap-5">
            <div className="grid gap-2"><h2 className="text-sm font-medium">Test a worker reply</h2><p className="text-sm text-muted-foreground">Send a message through the same process as a WhatsApp reply.</p></div>
            <ActionForm action={simulateMessageAction} submitLabel="Send as worker" submitIcon={<AnimatedIcon icon={Send} motion="slide" />} pendingLabel="Processing…" resetOnSuccess className="gap-4">
              <div className="grid gap-2">
                <Label htmlFor="test-worker">Worker</Label>
                <select id="test-worker" name="workerId" className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" required>
                  <option value="">Choose an active worker…</option>
                  {workers.filter((worker) => worker.active).map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="test-message">Message</Label>
                <Textarea id="test-message" name="text" rows={3} placeholder={SAMPLE_MESSAGES[0]} required />
              </div>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer py-1">Example messages</summary>
                <ul className="mt-2 flex flex-col gap-2">{SAMPLE_MESSAGES.map((message) => <li key={message} className="rounded-lg bg-muted/50 px-3 py-2">{message}</li>)}</ul>
              </details>
            </ActionForm>
          </div>
        </div>
      </details>
    </div>
  );
}
