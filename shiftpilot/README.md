# ShiftPilot

A WhatsApp agent that staffs a week of part-time shifts: it asks everyone for availability, chases non-responders, builds the roster, and finds cover when someone calls in sick. The manager approves before anything is sent or published.

## How it works

| Layer | Does | Where |
| --- | --- | --- |
| Deterministic code | Reminder timers, constraint solver (coverage, skills, hour caps, rest, fairness), replacement ranking, approval policy, privacy rules | `src/agent/solver.ts`, `ranking.ts`, `tick.ts`, `cover.ts` |
| Jev (TypeSafe, via OpenRouter) | Reads worker messages: intent, per-shift availability, which shift a sick call refers to, health mentions. Returns calibrated confidence | `src/agent/understand.ts` |
| GPT-6 Sol (via OpenRouter) | Turns the manager's goal into constraints, second opinion when Jev is unsure, explains the roster, drafts options when nobody can cover | `weekly.ts`, `cover.ts` |
| WhatsApp Cloud API | Messages, reply buttons, delivery receipts, 24-hour-window handling | `src/integrations/whatsapp.ts`, `src/agent/outbox.ts` |
| Google Sheets (optional) | Publishes the roster to a shared sheet | `src/integrations/sheets.ts` |

Approval gates: messaging the team, publishing the roster, any overtime offer, and what to do when nobody can cover. Replacement offers within everyone's limits are pre-approved (toggle in Settings). Shift offers never say who dropped out or why.

Everything the agent observes and does is written to the audit log (`/activity`), including Jev probabilities and costs.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values, see below
npm run db:push              # creates tables
npm run dev                  # http://localhost:3000
```

In a second terminal, expose the webhook (install once with `winget install --id Cloudflare.cloudflared`):

```bash
npm run tunnel               # prints https://<random>.trycloudflare.com
```

### WhatsApp Cloud API

1. In your Meta developer app, open **WhatsApp → API Setup**. Copy the **Phone number ID** (not the phone number) into `WHATSAPP_PHONE_NUMBER_ID`.
2. Add your 3 test phones under **To → Manage phone number list** and verify each one.
3. Create a permanent token (Business Settings → System users → Generate token, with `whatsapp_business_messaging` and `whatsapp_business_management`) and put it in `WHATSAPP_ACCESS_TOKEN`. The temporary token on API Setup expires in 24h.
4. **App settings → Basic → App secret** goes into `WHATSAPP_APP_SECRET`.
5. **WhatsApp → Configuration → Webhook**: callback `https://<tunnel>/api/whatsapp/webhook`, verify token = your `WHATSAPP_VERIFY_TOKEN`. Subscribe to the `messages` field.
6. Add the same three numbers as workers on `/workers` (with country code).

Meta only allows free-form messages within 24 hours of the worker's last message. Outside that window ShiftPilot sends the template in `WHATSAPP_TEMPLATE_NAME` (default `hello_world`) and queues the real message until the worker replies. For a smoother demo, create a Utility template such as `shiftpilot_update` with body `ShiftPilot update: {{1}}`, then set `WHATSAPP_TEMPLATE_NAME=shiftpilot_update` and `WHATSAPP_TEMPLATE_HAS_BODY_PARAM=true`.

The project's `.cursor/mcp.json` registers Meta's WhatsApp Business Tools MCP, which can list numbers, create that template, and configure the webhook from Cursor after you sign in.

## Demo script

1. `/workers`: add the 3 real phones, then **Add simulated workers** to fill out the roster.
2. `/`: type a goal, e.g. *"Staff next week. We're closed Monday, and weekend closing shifts need 3 people."* Show how the agent read it, then **Approve** messaging.
3. On the phones: reply in free text ("mornings tue-thu, not fri, weekends anything"). Leave one phone silent.
4. Header clock: **+12h** twice, so the silent worker gets two reminders and is then flagged.
5. Review the roster and summary, then **Approve** publishing. Everyone gets their shifts.
6. Move the clock to the day before a real worker's shift. From that phone: *"sorry cant come tmr, got fever"*. The agent releases the shift, ranks replacements, and offers it (with buttons) to the next person without mentioning who or why.
7. Decline on one phone, accept on another. Show the timeline on `/activity` and the numbers in **Value so far**.

No phones handy? The **Test console** on `/workers` sends a message through the same pipeline.

## Checks

```bash
npm test                 # solver + ranking unit tests
npm run typecheck
npx tsx scripts/e2e.ts   # full scenario against DATABASE_URL (resets demo data; uses OpenRouter)
```
