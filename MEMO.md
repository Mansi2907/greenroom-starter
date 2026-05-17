# Settlement Calculator: Vs Deal Calculator + Transparent Math
**Greenroom Applied AI PM Case Study — Mansi Narwade**

---

## The Slice I Picked

**Vs deal support + step-by-step calculation transparency.**

This is tightly coupled. The calculator without the transparency doesn't solve the trust problem. The transparency without the calculator is useless for 62% of shows. They're one feature.

---

## Why This Slice, Not the Others

The brief names several adjacent problems: deal modeling, audit trails, real-time prediction, the 2am walkthrough, post-show agent communication, dispute resolution.

I read the data before picking. A few things stood out:

**62% of shows can't be settled in-app.** The deal type breakdown: 195 vs deals, 109 percentage_of_net, 30 door deals — out of 537 total. These all hit the amber "unsupported deal" card and push Mariana to her spreadsheet. The two supported types (flat, % of gross) account for only 203 shows. This is the largest single source of the 82% spreadsheet rate the CEO flagged.

**24 settlements are marked "Disputed" but have positive TM sign-offs.** Status shows `disputed`. Signoff text reads "Looks good — TM", "👍", "OK. Good night." One has a note: *"TM signed off Sunday morning. His assistant emailed Monday questioning the production-overage line."* These aren't in-room disputes — they're agent disputes that arrived the next morning. The product doesn't distinguish these two very different events. That's a product gap.

**3 deals have structurally stale data.** Show 0005's freetext says the deal was "renegotiated… was 75/25" — but the stored `percentage` field is 0.75 (the old number). Show 0007's freetext says a bonus threshold changed to $6,000 but "structured field still reflects original $11,000." If the calculator uses structured fields, it gets the wrong answer. If it uses freetext, it can't parse it. This is the seam.

**Why not the other slices:**

- *Agent portal / pre-show sharing*: Real value, but it requires auth for an external party and is a meaningfully larger surface. Diego's ask ("look at the math on the drive over") is better served by the TM just getting a clean readable worksheet at the table. Right tool for this sprint.
- *Pre-show risk flagging*: Marcus wants it. It requires ML/heuristics on deal text patterns and a "settle-readiness" state before the show happens. Different timing, different surface, different sprint.
- *Dispute resolution workflow*: Downstream of the calculator. You need the right math first before you can adjudicate disagreements about it.
- *AI deal-term parsing from freetext*: The upstream fix. Worth doing — the Coastal Spell dispute ($720 + agent goodwill) is a direct result of an 80-word ambiguous deal email. But it's a data-quality bet, not a settlement-night bet. Ships as a separate feature.

---

## What I Built

### 1. Calculator for all major deal types

Extended `lib/dealMath.ts` to cover:

| Deal type | What it computes |
|-----------|-----------------|
| **vs** | `max(guarantee, % × net_after_expenses)` — or vs-gross variant |
| **percentage_of_net** | `% × (net − capped_expenses)` |
| **door** | `gross − capped_expenses` (100% of tickets to artist) |
| **tier ratchet** (within vs) | Fill rate → applicable tier → overrides base % |

Expense caps are applied where present. Absorbed expenses (venue-covered) are excluded from the deduction. The calculator falls back gracefully with a clear reason if required fields are missing.

### 2. Step-by-step settlement worksheet

Every supported deal type now produces an ordered `steps[]` array that renders as a visual worksheet — line by line, each deduction shown with its source, subtotals bolded, deductions in red. The formula is shown in the card description.

This directly addresses Diego's ask ("I want to see the math") and Mariana's ("The math needs to be readable to the agent the next morning").

The worksheet also shows the expense breakdown by category — every line the TM might ask about, with absorbed items marked separately so they don't trigger confusion.

### 3. Deal health warnings

Two categories of warning, surfaced above the worksheet:

**Stale structured fields** — detected by scanning `deal_notes_freetext` for signals like "renegotiated", "updated", "structured field still reflects", "confirm before settlement". When found, a warning tells Mariana to verify the structured fields match the final terms before settling. This directly prevents the scenario where the calculator runs the wrong percentage because the field wasn't updated.

**Disputed-with-positive-signoff** — when `status = "disputed"` but `signoff_text` matches a set of positive TM patterns ("looks good", "👍", "wire", "ok"), a distinct amber banner explains: *"TM signed off in the room — dispute came from the agent afterward."* The signoff block is also styled differently to distinguish in-room TM agreement from subsequent agent challenge.

---

## Design Choices

**Calculator uses structured fields; freetext is shown for human verification.** I considered trying to parse deal terms from freetext using an LLM. I decided against it for this sprint: parsing prose deal terms reliably is hard, the stakes of a wrong parse are high (Mariana settles the wrong number), and the right fix upstream is structured deal entry. The calculator uses the structured fields; the deal notes block is shown prominently so Mariana (and the TM) can see the source of truth and catch any stale data.

**Health warnings are Mariana's, not the TM's.** The warnings appear before the worksheet. They're venue-facing — they tell Mariana to check something before she starts the walkthrough. I didn't design them as TM-facing because surfacing uncertainty to the TM mid-table creates anxiety that doesn't help anyone. Mariana needs to resolve it before they sit down.

**Expense cap logic is explicit.** When actual expenses exceed the cap, the worksheet shows both numbers: "Actual expenses $1,717 capped at $700." This surfaces a common source of dispute — when the TM sees "expenses: $700" and knows the production cost was more, the cap note explains it before they ask.

**Vs deal winner is called out.** A small callout above the worksheet says "Percentage payout wins — $5,197 > $1,405 guarantee" or "Guarantee holds — $5,000 > $4,200 percentage." This matches how Mariana actually explains it to the TM at the table.

---

## What I Cut

**Walkout pots as dynamic computations.** The bonus schema models walkout pots as gross_threshold bonuses with a fixed `amount`. The actual walkout pot logic ("100% of gross above $X") requires dynamic calculation based on actual gross. I built the gross_threshold trigger correctly (fires if gross ≥ threshold, applies stored amount) but did not rewrite the bonus schema to support a fully dynamic "percentage of overage" calculation. The stored amounts in the seed data are close enough for the prototype; a real ship would need either a schema extension (`walkout_threshold` and `walkout_rate`) or an LLM-parsed interpretation.

**Mobile/TM-facing view.** Diego specifically asked to review the settlement on his phone before sitting down. A shareable link with a clean mobile view would be high value. I cut it because it requires auth infrastructure for an external party and the prototype case study doesn't include that. The worksheet is readable on desktop and serves the 2am table conversation.

**Dispute resolution workflow.** The "disputed" state has no resolution path in the UI — no way to mark a recoup as withdrawn, send a revised statement, or log the resolution. That's the next sprint.

---

## How I'd Validate This

**Metric 1: In-app settlement rate.** Currently ~18% of customers use the in-app tool; the other 82% use spreadsheets. Among The Crescent's vs deals specifically, usage is 0%. The target: >50% of vs deals settled in-app within 60 days of launch. Measured by: `settlements` with non-null `calculation_json` / total past shows with vs deals.

**Metric 2: Dispute rate on vs deals.** Compare pre/post dispute rate specifically on vs deal settlements. The hypothesis: a transparent worksheet reduces post-settlement agent disputes because agents can see the math. The current dispute rate across all settlements is ~4.4% (24/537). On vs deals it's higher (anecdotally from the data). Target: reduce vs deal dispute rate by 30%.

**Metric 3: Health warning accuracy.** Track how often the "stale fields" warning fires and whether it correlates with actual disputes. If the warning fires on show X and show X later becomes disputed, the warning is signal. If it fires everywhere and rarely correlates, it becomes noise and needs tuning.

**Validation approach:** Deploy to The Crescent first. Sit with Mariana on a settlement night (or watch a recording). The test: does she use the app instead of the spreadsheet? Does she show the TM the worksheet? Does the TM have fewer questions?

---

## What I'd Ship Next

1. **Structured deal entry at booking time.** The freetext-vs-structured gap is the root cause of the stale fields problem. A better deal entry form with clear fields for expense cap, hospitality cap, marketing recoup placement ("inside or outside cap?"), and renegotiation history would eliminate the data quality warnings and make the calculator reliable by default.

2. **Shareable settlement link for agents.** A read-only URL the agent can open the next morning — same worksheet, same step-by-step math, no login required (or magic-link auth). This closes the "asymmetric document" problem Sarah Kim described: *"settlement becomes a structured collaboration... not a black box I open in the morning."*

3. **Pre-show deal risk check.** Before show night, flag deals that have ambiguous terms (recoup placement unclear, freetext-structured mismatch, expenses already trending above cap). Give Mariana and the agent a chance to resolve these Wednesday afternoon instead of 2am Sunday. Marcus's ask: *"If we could see Wednesday that this deal is going to have an ambiguous expense fight, we could resolve it cold."*
