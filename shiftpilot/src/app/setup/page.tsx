import { eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { getWorkspace } from "@/agent/context";
import { getSetupStatus, SETUP_STEPS, setupPages, webhookSeen } from "@/agent/setup";
import { getDb, schema } from "@/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { CopyButton } from "@/components/copy-button";
import { StepForm } from "@/components/step-form";
import { getBusinessNumber } from "@/integrations/whatsapp";
import { PRESETS } from "@/lib/presets";
import { DAY_SHORT } from "@/lib/time";
import { cn } from "@/lib/utils";

const TIMEZONES = [
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Bangkok",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];

const bigInput =
  "h-14 w-full rounded-xl border border-input bg-background px-4 text-xl outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const choice =
  "flex w-full flex-col items-start rounded-xl border bg-background px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 outline-none";

function Question({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium tracking-tight text-balance">{title}</h1>
        {hint && <p className="text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function daysLabel(days: number[]) {
  if (days.length === 7) return "every day";
  if (days.join() === "0,1,2,3,4") return "weekdays";
  if (days.join() === "5,6") return "weekends";
  return days.map((d) => DAY_SHORT[d]).join(", ");
}

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  await connection();
  const params = await searchParams;
  const ws = await getWorkspace();
  const pages = setupPages(ws);
  const status = await getSetupStatus();
  const firstGroup = SETUP_STEPS.find((s) => !status.done[s.key])?.key ?? "week";
  const requested = typeof params.step === "string" ? params.step : undefined;
  const index = Math.max(0, requested ? pages.findIndex((p) => p.key === requested) : pages.findIndex((p) => p.group === firstGroup));
  const page = pages[index];
  const progress = ((index + 1) / pages.length) * 100;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="h-1 w-full bg-muted" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={pages.length} aria-label="Setup progress">
        <div className="h-full bg-primary transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex items-center justify-between px-6 py-4 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {index + 1} of {pages.length}
        </span>
        <Link href="/" className="hover:text-foreground">
          Exit setup
        </Link>
      </div>

      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-xl">
          <Step pageKey={page.key} />
          {index > 0 && (
            <Link href={`/setup?step=${encodeURIComponent(pages[index - 1].key)}`} className="mt-8 inline-block text-sm text-muted-foreground hover:text-foreground">
              ← Back
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}

async function Step({ pageKey }: { pageKey: string }) {
  const ws = await getWorkspace();

  if (pageKey === "name")
    return (
      <Question title="What's your business called?" hint="Your staff will see this name in WhatsApp messages.">
        <StepForm step="name">
          <input name="value" defaultValue={ws.businessName} autoFocus required aria-label="Business name" className={bigInput} />
        </StepForm>
      </Question>
    );

  if (pageKey === "timezone") {
    const zones = TIMEZONES.includes(ws.timezone) ? TIMEZONES : [ws.timezone, ...TIMEZONES];
    return (
      <Question title="Which timezone are you in?" hint="Shift times and reminders follow this clock.">
        <StepForm step="timezone">
          <select name="value" defaultValue={ws.timezone} autoFocus aria-label="Timezone" className={bigInput}>
            {zones.map((z) => (
              <option key={z} value={z}>{z.replace(/_/g, " ").replace("/", " / ")}</option>
            ))}
          </select>
        </StepForm>
      </Question>
    );
  }

  if (pageKey === "type")
    return (
      <Question title="What kind of business is it?" hint="This fills in typical shifts. You'll set how many people each needs next.">
        <StepForm step="type" hideSubmit>
          <div className="flex flex-col gap-3">
            {PRESETS.map((p) => (
              <button key={p.key} type="submit" name="value" value={p.key} className={cn(choice, ws.presetKey === p.key && "border-primary ring-1 ring-primary")}>
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-muted-foreground">{p.shiftTemplates.map((t) => t.label).join(" · ")}</span>
              </button>
            ))}
          </div>
        </StepForm>
      </Question>
    );

  if (pageKey.startsWith("shift:")) {
    const t = ws.shiftTemplates.find((x) => x.key === pageKey.slice(6));
    if (!t) return <Question title="That shift no longer exists.">{null}</Question>;
    return (
      <Question
        title={`How many people do you need on ${t.label.toLowerCase()}?`}
        hint={`${t.start}–${t.end}, ${daysLabel(t.days)}${t.requiredSkills.length ? `. Needs at least one ${t.requiredSkills.join(" and ")}.` : "."} You can change times later in Settings.`}
      >
        <StepForm step={pageKey}>
          <input name="value" type="number" min={1} max={50} defaultValue={t.requiredCount} autoFocus required aria-label="People needed" className={cn(bigInput, "w-40")} />
        </StepForm>
      </Question>
    );
  }

  if (pageKey === "hours")
    return (
      <Question title="What's the most one person should work in a week?" hint="The agent never goes over this without asking you. You can set a different limit for individuals later.">
        <StepForm step="hours">
          <div className="flex items-center gap-3">
            <input name="value" type="number" min={1} max={80} defaultValue={ws.rules.maxHoursPerWeek} autoFocus required aria-label="Max hours per week" className={cn(bigInput, "w-40")} />
            <span className="text-xl text-muted-foreground">hours</span>
          </div>
        </StepForm>
      </Question>
    );

  if (pageKey === "reminders")
    return (
      <Question title="If someone doesn't reply, when should I remind them?" hint={`I'll remind them up to ${ws.rules.maxReminders} times, then let you know.`}>
        <StepForm step="reminders">
          <div className="flex items-center gap-3">
            <span className="text-xl text-muted-foreground">after</span>
            <input name="value" type="number" min={0.5} max={72} step={0.5} defaultValue={ws.rules.reminderAfterHours} autoFocus required aria-label="Hours before a reminder" className={cn(bigInput, "w-32")} />
            <span className="text-xl text-muted-foreground">hours</span>
          </div>
        </StepForm>
      </Question>
    );

  if (pageKey === "autoOffer")
    return (
      <Question title="When someone calls in sick, can I offer their shift to others without asking you?" hint="Overtime and shifts nobody can take always come to you.">
        <StepForm step="autoOffer" hideSubmit>
          <div className="flex flex-col gap-3">
            <button type="submit" name="value" value="yes" className={cn(choice, ws.autoOfferReplacements && "border-primary ring-1 ring-primary")}>
              <span className="font-medium">Yes, if it fits within their hours</span>
              <span className="text-sm text-muted-foreground">Recommended. Gaps get covered faster.</span>
            </button>
            <button type="submit" name="value" value="no" className={cn(choice, !ws.autoOfferReplacements && "border-primary ring-1 ring-primary")}>
              <span className="font-medium">No, ask me before every offer</span>
            </button>
          </div>
        </StepForm>
      </Question>
    );

  if (pageKey === "team") {
    const existing = await getDb().select().from(schema.workers).where(eq(schema.workers.simulated, false));
    return (
      <Question
        title="Who's on your team?"
        hint={
          <>
            One person per line: name, WhatsApp number with country code, and skills if any
            {ws.skills.length ? ` (${ws.skills.join(", ")})` : ""}.
          </>
        }
      >
        <StepForm step="team" enterHint={false}>
          <textarea
            name="value"
            rows={6}
            autoFocus
            aria-label="Team members"
            placeholder={`Aisha, +65 9123 4567, ${ws.skills[0] ?? ""}\nBen, +65 8123 4567`}
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-lg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {existing.length > 0 && (
            <p className="text-sm text-muted-foreground">Already added: {existing.map((w) => w.name).join(", ")}. Leave this empty to keep going.</p>
          )}
        </StepForm>
      </Question>
    );
  }

  if (pageKey === "simulated") {
    const [sim] = await getDb().select().from(schema.workers).where(eq(schema.workers.simulated, true)).limit(1);
    return (
      <Question
        title="Add pretend staff for testing?"
        hint="Useful if you only have a few phones. They're marked “sim”, never get messages, and reply instantly, so the roster looks realistic."
      >
        <StepForm step="simulated" hideSubmit>
          <div className="flex flex-col gap-3">
            <button type="submit" name="value" value="yes" className={choice}>
              <span className="font-medium">{sim ? "Yes, add more" : "Yes, add 9 simulated staff"}</span>
            </button>
            <button type="submit" name="value" value="no" className={choice}>
              <span className="font-medium">{sim ? "No, I have enough" : "No, only real people"}</span>
            </button>
          </div>
        </StepForm>
      </Question>
    );
  }

  if (pageKey === "whatsapp") {
    const [number, seen] = await Promise.all([getBusinessNumber(), webhookSeen()]);
    const real = (await getDb().select().from(schema.workers).where(eq(schema.workers.active, true))).filter((w) => !w.simulated && w.phone);
    const link = number.ok ? `https://wa.me/${number.digits}?text=${encodeURIComponent("Hi")}` : null;
    const invite = `Hi! ${ws.businessName} now sends rosters on WhatsApp. Please send "Hi" to ${number.ok ? number.display : "our scheduling number"}${link ? `: ${link}` : "."}`;
    const connected = real.filter((w) => w.lastInboundAt).length;
    return (
      <Question
        title="Ask everyone to say hi"
        hint={
          number.ok
            ? `WhatsApp only lets me message people who've messaged ${number.display} first. One "Hi" each is enough.`
            : `I can't reach WhatsApp yet: ${number.error}. Check the token and phone number ID in .env.local.`
        }
      >
        <AutoRefresh seconds={4} />
        <StepForm step="whatsapp" enterHint={false} submitLabel={real.length && connected === real.length ? "Continue" : "Continue anyway"}>
          {number.ok && (
            <div className="flex items-center gap-2">
              <CopyButton text={invite} label="Copy invite for your team" />
              {link && (
                <a href={link} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  Open chat
                </a>
              )}
            </div>
          )}
          <ul className="flex flex-col divide-y rounded-xl border">
            {real.map((w) => (
              <li key={w.id} className="flex items-center justify-between px-4 py-3">
                <span>{w.name}</span>
                {w.lastInboundAt ? <span className="text-sm text-emerald-700">✓ connected</span> : <span className="text-sm text-muted-foreground">waiting…</span>}
              </li>
            ))}
            {real.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No one with a WhatsApp number yet. Go back to add your team.</li>}
          </ul>
          {!seen && number.ok && (
            <p className="text-sm text-muted-foreground">Nothing received yet. If a message doesn&apos;t show up here, check the tunnel is running and the webhook URL in Meta is current.</p>
          )}
        </StepForm>
      </Question>
    );
  }

  return (
    <Question title="What do you need for your first week?" hint="Plain words are fine. I'll show you my plan, and nobody is messaged until you approve it.">
      <StepForm step="goal" submitLabel="Plan my first week" enterHint={false}>
        <textarea
          name="value"
          rows={3}
          autoFocus
          required
          aria-label="Goal for the first week"
          defaultValue="Staff next week with the normal pattern."
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-lg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-sm text-muted-foreground">e.g. &ldquo;closed Monday&rdquo;, &ldquo;3 people on weekend closing&rdquo;, &ldquo;nobody over 24 hours&rdquo;</p>
      </StepForm>
    </Question>
  );
}
