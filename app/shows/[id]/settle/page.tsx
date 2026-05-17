import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  AlertTriangle,
  Mail,
  Pencil,
  XCircle,
  Wallet,
  TrendingUp,
  Info,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import { getShowById } from "@/lib/queries";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Field,
} from "@/components/ui/card";
import { StatusBadge, DealTypeBadge, PlainBadge } from "@/components/ui/badge";
import { calculateSettlement, type DealHealthWarning } from "@/lib/dealMath";
import { formatMoney, formatShowDateFull } from "@/lib/format";
import type { Settlement, Recoup } from "@/db/schema";
import { Logomark } from "@/components/brand/logo";

const RECOUP_LABELS: Record<Recoup["category"], string> = {
  marketing: "Marketing",
  hospitality_overage: "Hospitality overage",
  production_overage: "Production overage",
  prior_advance: "Prior advance",
  damages: "Damages",
  other: "Other",
};

const DEAL_TYPE_LABELS: Record<string, string> = {
  flat: "flat guarantee",
  percentage_of_gross: "percentage of gross",
  percentage_of_net: "percentage of net",
  vs: "vs deal",
  door: "door deal",
};

/** Positive TM sign-off text patterns that indicate in-room agreement */
const POSITIVE_SIGNOFF_PATTERNS = [
  /looks good/i,
  /ok\b/i,
  /👍/,
  /sign off/i,
  /wire/i,
  /good night/i,
];

function isPositiveSignoff(text: string | null | undefined): boolean {
  if (!text) return false;
  return POSITIVE_SIGNOFF_PATTERNS.some((p) => p.test(text));
}

export default async function SettlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getShowById(id);
  if (!data) notFound();

  const { show, artist, deal, ticketSales, expenses, settlement, recoups } =
    data;

  if (!deal) {
    return (
      <div className="px-12 py-10 max-w-4xl">
        <BackLink showId={show.id} />
        <div className="text-[13px] text-ink-400">
          No deal entered for this show. Settlement can&apos;t run yet.
        </div>
      </div>
    );
  }

  const calc = calculateSettlement({
    deal,
    ticketSales,
    expenses,
    venueCapacity: data.venue?.capacity ?? undefined,
  });

  const grossSoFar = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);

  const disputedRecoups = recoups.filter((r) => r.status === "disputed");
  const isDisputed =
    settlement?.status === "disputed" ||
    settlement?.status === "revised" ||
    !!settlement?.disputedAt;
  const disputedRecoupValue = disputedRecoups.reduce(
    (s, r) => s + r.amount,
    0,
  );

  // Key anomaly: "disputed" status but TM signed off positively in the room.
  // The dispute came from the agent the *next morning*, not the TM at the table.
  const tmSignedOffPositively =
    isDisputed && isPositiveSignoff(settlement?.signoffText);

  const healthWarnings = calc.healthWarnings ?? [];

  return (
    <div
      className={`px-12 py-10 max-w-7xl ${isDisputed ? "bg-gradient-to-b from-rose-50/30 via-canvas to-canvas" : ""}`}
    >
      <BackLink showId={show.id} />

      <div className="mb-12">
        <div className="flex items-center gap-1.5 mb-4">
          <StatusBadge status={show.status} />
          <DealTypeBadge type={deal.dealType} />
          {settlement?.status === "disputed" && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-medium ring-1 ring-inset bg-rose-50 text-rose-800 ring-rose-200/80">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
              </span>
              Disputed
            </span>
          )}
          {settlement?.status === "voided" && (
            <PlainBadge variant="default">Voided</PlainBadge>
          )}
        </div>
        <h1
          className="font-display text-[48px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.02em", fontOpticalSizing: "auto" }}
        >
          Settlement · {artist?.name}
        </h1>
        <div className="text-[14px] text-ink-400 mt-3">
          {formatShowDateFull(show.date)}
        </div>
      </div>

      {/* ── Data anomaly: TM signed off but status shows disputed ─────────── */}
      {tmSignedOffPositively && (
        <div className="mb-6 rounded-lg border border-amber-200/70 bg-amber-50/50 p-5 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
          <div>
            <div className="text-[13px] font-semibold text-amber-900">
              TM signed off in the room — dispute came from the agent afterward
            </div>
            <p className="text-[12.5px] text-ink-600 mt-1 leading-relaxed">
              The tour manager&apos;s sign-off (&ldquo;
              {settlement?.signoffText}&rdquo;) indicates in-room agreement.
              This settlement was marked disputed after the fact — likely from
              an agent email the next day. The TM&apos;s position at the table
              and the agent&apos;s later read may differ.
            </p>
          </div>
        </div>
      )}

      {/* ── Standard disputed callout ──────────────────────────────────────── */}
      {isDisputed && !tmSignedOffPositively && disputedRecoupValue > 0 && (
        <div className="mb-6 rounded-lg border border-rose-200/60 bg-rose-50/40 p-5 flex gap-3">
          <AlertTriangle className="h-4 w-4 text-rose-700 mt-0.5 shrink-0" />
          <div>
            <div className="text-[13px] font-semibold text-rose-800">
              {disputedRecoups.length} recoup
              {disputedRecoups.length === 1 ? "" : "s"} in dispute ·{" "}
              {formatMoney(disputedRecoupValue)} contested
            </div>
            <p className="text-[12.5px] text-ink-600 mt-1 leading-relaxed">
              The artist team has flagged recoup line items. This settlement
              cannot be finalized until the dispute is resolved.
            </p>
          </div>
        </div>
      )}

      {/* ── Deal health warnings ──────────────────────────────────────────── */}
      {healthWarnings.length > 0 && (
        <DealHealthSection warnings={healthWarnings} />
      )}

      {settlement && (
        <LifecycleBar
          settlement={settlement}
          disputedRecoups={disputedRecoups.length}
        />
      )}

      <div className="space-y-6 mt-6">
        {!calc.supported ? (
          <UnsupportedDeal
            dealType={calc.dealType}
            deal={deal}
            existingSettlement={settlement}
            grossSoFar={grossSoFar}
            totalFees={totalFees}
            totalExpenses={totalExpenses}
            ticketCount={ticketSales.reduce((s, t) => s + (t.qty ?? 0), 0)}
            expenseRowCount={expenses.length}
          />
        ) : (
          <SupportedSettlement
            calc={calc}
            existingSettlement={settlement}
            dealNotesFreetext={deal.dealNotesFreetext}
            expenseRows={expenses}
          />
        )}

        {recoups.length > 0 && <RecoupsSection recoups={recoups} />}

        {settlement && (settlement.signoffText || settlement.notes) && (
          <SignoffSection
            settlement={settlement}
            tmSignedOffPositively={tmSignedOffPositively}
          />
        )}
      </div>

      <div className="mt-16 pt-10 border-t border-ink-200/60">
        <div className="flex gap-4 items-start max-w-3xl">
          <Logomark size={40} className="shrink-0" />
          <div>
            <h2
              className="font-display text-[20px] font-medium text-ink-900 mb-2"
              style={{ letterSpacing: "-0.02em" }}
            >
              You&apos;re looking at the seam this case study is about.
            </h2>
            <p className="text-[13px] text-ink-500 leading-relaxed">
              Greenroom&apos;s in-app settlement tool was built early in the
              company&apos;s history, when most deals were flat guarantees.
              About 18% of customers actively use it; the other 82% — including
              most of the larger venues — default to spreadsheets. The CEO has
              flagged this as the company&apos;s biggest craft gap.{" "}
              <Link
                href="/context"
                className="text-brand-700 font-medium hover:text-brand-800 hover:underline inline-flex items-center gap-0.5"
              >
                Where to start <ArrowRight className="h-3 w-3" />
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function BackLink({ showId }: { showId: string }) {
  return (
    <Link
      href={`/shows/${showId}`}
      className="inline-flex items-center gap-1 text-[12px] text-ink-400 hover:text-ink-900 mb-8 transition-colors"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to show
    </Link>
  );
}

function DealHealthSection({ warnings }: { warnings: DealHealthWarning[] }) {
  return (
    <div className="mb-6 space-y-2">
      {warnings.map((w) => (
        <div
          key={w.code}
          className={`rounded-lg border p-4 flex gap-3 ${
            w.severity === "warn"
              ? "border-amber-200/70 bg-amber-50/50"
              : "border-sky-200/70 bg-sky-50/40"
          }`}
        >
          {w.severity === "warn" ? (
            <ShieldAlert className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
          ) : (
            <Info className="h-4 w-4 text-sky-700 mt-0.5 shrink-0" />
          )}
          <div>
            <div
              className={`text-[13px] font-semibold ${w.severity === "warn" ? "text-amber-900" : "text-sky-900"}`}
            >
              {w.message}
            </div>
            {w.detail && (
              <p className="text-[12.5px] text-ink-600 mt-1 leading-relaxed">
                {w.detail}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

type Stage = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  timestamp?: Date | null;
};

function LifecycleBar({
  settlement,
  disputedRecoups,
}: {
  settlement: Settlement;
  disputedRecoups: number;
}) {
  if (settlement.status === "voided") {
    return (
      <div className="rounded-lg border border-ink-200/80 bg-white px-5 py-4 flex items-center gap-3">
        <XCircle className="h-4 w-4 text-ink-400" />
        <div>
          <div className="text-[13px] font-medium text-ink-900">
            Settlement voided
          </div>
          <div className="text-[11.5px] text-ink-400 mt-0.5">
            The show was cancelled or the settlement was scrapped.
          </div>
        </div>
      </div>
    );
  }

  const stages: Stage[] = [
    {
      key: "draft",
      label: "Drafted",
      icon: Pencil,
      timestamp: settlement.draftedAt,
    },
    {
      key: "submitted",
      label: "Submitted",
      icon: Mail,
      timestamp: settlement.submittedAt,
    },
    {
      key: "review",
      label: "Reviewed",
      icon: TrendingUp,
      timestamp: settlement.reviewStartedAt,
    },
    {
      key: "signed",
      label: settlement.disputedAt ? "Finalized" : "Signed",
      icon: Check,
      timestamp: settlement.finalizedAt ?? settlement.signedAt,
    },
    {
      key: "paid",
      label: "Paid",
      icon: Wallet,
      timestamp: settlement.paidAt,
    },
  ];

  const currentIndex = (() => {
    switch (settlement.status) {
      case "draft":
        return 0;
      case "submitted":
        return 1;
      case "in_review":
        return 2;
      case "disputed":
      case "signed":
      case "revised":
      case "finalized":
        return 3;
      case "paid":
        return 4;
      default:
        return 0;
    }
  })();

  const isDisputed =
    settlement.status === "disputed" ||
    settlement.status === "revised" ||
    !!settlement.disputedAt;

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between mb-4">
          <div className="eyebrow text-[10px] text-ink-400">
            Settlement lifecycle
          </div>
          {isDisputed && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700">
              <AlertTriangle className="h-3 w-3" />
              {settlement.status === "disputed"
                ? "In dispute"
                : settlement.status === "revised"
                  ? "Revision sent"
                  : "Resolved after dispute"}
              {disputedRecoups > 0 && (
                <span className="text-rose-600">
                  · {disputedRecoups} disputed recoup
                  {disputedRecoups === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-5 gap-1 relative">
          <div className="absolute top-3.5 left-[10%] right-[10%] h-px bg-ink-200/60" />

          {stages.map((stage, i) => {
            const isComplete = i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = i > currentIndex;
            const Icon = stage.icon;

            const stageDot = (() => {
              if (isComplete) return "bg-brand-700 ring-brand-700 text-white";
              if (isCurrent) {
                return isDisputed
                  ? "bg-rose-50 ring-rose-500 text-rose-700"
                  : "bg-brand-50 ring-brand-700 text-brand-700";
              }
              return "bg-white ring-ink-200/80 text-ink-300";
            })();

            return (
              <div
                key={stage.key}
                className="flex flex-col items-center text-center"
              >
                <div
                  className={`relative z-10 w-7 h-7 rounded-full ring-2 flex items-center justify-center ${stageDot}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div
                  className={`mt-2.5 text-[11px] font-medium leading-tight ${
                    isFuture ? "text-ink-300" : "text-ink-900"
                  }`}
                >
                  {stage.label}
                </div>
                <div className="text-[10px] text-ink-400 mt-0.5 font-mono tabular leading-tight min-h-[12px]">
                  {stage.timestamp
                    ? new Date(stage.timestamp).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : ""}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function UnsupportedDeal({
  dealType,
  deal,
  existingSettlement,
  grossSoFar,
  totalFees,
  totalExpenses,
  ticketCount,
  expenseRowCount,
}: {
  dealType: string;
  deal: NonNullable<Awaited<ReturnType<typeof getShowById>>>["deal"];
  existingSettlement: NonNullable<
    Awaited<ReturnType<typeof getShowById>>
  >["settlement"];
  grossSoFar: number;
  totalFees: number;
  totalExpenses: number;
  ticketCount: number;
  expenseRowCount: number;
}) {
  return (
    <>
      <Card accent="amber">
        <CardContent className="py-12 text-center">
          <h2
            className="font-display text-[22px] font-medium text-ink-900 mb-2"
            style={{ letterSpacing: "-0.02em" }}
          >
            The in-app tool can&apos;t settle a{" "}
            {DEAL_TYPE_LABELS[dealType] ?? dealType} yet.
          </h2>
          <p className="text-[13px] text-ink-500 max-w-md mx-auto leading-relaxed">
            Mariana would do this on a Google Sheet at 2am tonight. The inputs
            are below — but the math doesn&apos;t happen here.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>What the system has</CardTitle>
            <CardDescription>
              The inputs Mariana would pull together to settle this show.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Field
              label="Gross box office"
              mono
              value={formatMoney(grossSoFar)}
            />
            <Field label="Fees" mono value={formatMoney(totalFees)} />
            <Field
              label="Net box office"
              mono
              value={formatMoney(grossSoFar - totalFees)}
            />
          </div>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Field label="Tickets sold" mono value={String(ticketCount)} />
            <Field
              label="Expenses (line items)"
              mono
              value={String(expenseRowCount)}
            />
            <Field
              label="Expenses (passed through)"
              mono
              value={formatMoney(totalExpenses)}
            />
          </div>
          {deal?.dealNotesFreetext && (
            <div className="mt-6">
              <div className="eyebrow text-[10px] text-ink-500 mb-2">
                Deal notes (free text — what Mariana actually trusts)
              </div>
              <div className="text-[12.5px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed">
                {deal.dealNotesFreetext}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {existingSettlement?.totalToArtist != null && (
        <Card
          accent={
            existingSettlement.status === "disputed" ? "rose" : "brand"
          }
        >
          <CardHeader>
            <div>
              <CardTitle>Actually settled (off-platform)</CardTitle>
              <CardDescription>
                Mariana ran this in a spreadsheet. Here&apos;s the result that
                was logged back into Greenroom afterward.
              </CardDescription>
            </div>
            {existingSettlement.status === "disputed" ? (
              <PlainBadge variant="rose">Disputed</PlainBadge>
            ) : (
              <PlainBadge variant="brand">Signed</PlainBadge>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between py-2">
              <span className="text-[13px] text-ink-600">Total to artist</span>
              <span
                className="text-[32px] font-mono tabular font-semibold text-ink-900"
                style={{ letterSpacing: "-0.02em" }}
              >
                {formatMoney(existingSettlement.totalToArtist)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function SupportedSettlement({
  calc,
  existingSettlement,
  dealNotesFreetext,
  expenseRows,
}: {
  calc: Extract<ReturnType<typeof calculateSettlement>, { supported: true }>;
  existingSettlement: NonNullable<
    Awaited<ReturnType<typeof getShowById>>
  >["settlement"];
  dealNotesFreetext?: string | null;
  expenseRows: NonNullable<
    Awaited<ReturnType<typeof getShowById>>
  >["expenses"];
}) {
  const prevSettledAmount = existingSettlement?.totalToArtist;
  const hasDivergence =
    prevSettledAmount != null &&
    Math.abs(prevSettledAmount - calc.totalToArtist) > 0.5;

  return (
    <>
      {/* Hero number */}
      <div className="text-center py-10 mb-2">
        <div className="eyebrow text-[10px] text-ink-400 mb-3">
          Total to artist
        </div>
        <div
          className="text-[72px] font-mono tabular font-bold text-ink-900 leading-none"
          style={{ letterSpacing: "-0.03em" }}
        >
          {formatMoney(calc.totalToArtist)}
        </div>
        {existingSettlement && (
          <div className="mt-3">
            {existingSettlement.status === "paid" ? (
              <PlainBadge variant="brand">Paid</PlainBadge>
            ) : existingSettlement.status === "signed" ||
              existingSettlement.status === "finalized" ? (
              <PlainBadge variant="brand">Signed</PlainBadge>
            ) : existingSettlement.status === "disputed" ? (
              <PlainBadge variant="rose">Disputed</PlainBadge>
            ) : null}
          </div>
        )}
        {hasDivergence && prevSettledAmount != null && (
          <div className="text-[12px] text-amber-700 mt-3 flex items-center justify-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Spreadsheet settled at{" "}
            <span className="font-mono tabular font-medium">
              {formatMoney(prevSettledAmount)}
            </span>{" "}
            — differs by{" "}
            <span className="font-mono tabular font-medium">
              {formatMoney(Math.abs(prevSettledAmount - calc.totalToArtist))}
            </span>
          </div>
        )}
      </div>

      {/* vs deal winner callout */}
      {calc.vsWinner != null && (
        <div
          className={`rounded-lg border px-5 py-4 flex items-center gap-3 ${
            calc.vsWinner === "percentage"
              ? "border-brand-200/60 bg-brand-50/30"
              : "border-ink-200/60 bg-canvas-soft"
          }`}
        >
          <div className="text-[12.5px] text-ink-700">
            <span className="font-semibold">
              {calc.vsWinner === "percentage"
                ? "Percentage payout wins"
                : "Guarantee holds"}
            </span>
            {" — "}
            {calc.vsWinner === "percentage" ? (
              <>
                {formatMoney(calc.vsPercentagePayout)} &gt;{" "}
                {formatMoney(calc.vsGuarantee)} guarantee
              </>
            ) : (
              <>
                {formatMoney(calc.vsGuarantee)} guarantee &gt;{" "}
                {formatMoney(calc.vsPercentagePayout)} percentage
              </>
            )}
          </div>
        </div>
      )}

      {/* Main worksheet */}
      <Card accent="brand">
        <CardHeader>
          <div>
            <CardTitle>Settlement worksheet</CardTitle>
            <CardDescription className="font-mono text-[11px] break-all">
              {calc.finalFormula}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-ink-100/80">
            {calc.steps.map((step, i) => (
              <WorksheetRow key={i} step={step} />
            ))}
            <div className="pt-3" />
            <div className="flex items-baseline justify-between py-3 font-semibold">
              <span className="text-[13px] text-ink-900">Total to artist</span>
              <span className="text-[18px] font-mono tabular text-ink-900">
                {formatMoney(calc.totalToArtist)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Expense breakdown — sources the TM can ask about */}
      {expenseRows.length > 0 && (
        <ExpenseBreakdown expenseRows={expenseRows} />
      )}

      {/* Deal notes — the source of truth Mariana trusts */}
      {dealNotesFreetext && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Deal notes</CardTitle>
              <CardDescription>
                The agreed terms as Mariana entered them. When structured fields
                and deal notes conflict, this is what matters.
              </CardDescription>
            </div>
            <PlainBadge variant="default">Source of truth</PlainBadge>
          </CardHeader>
          <CardContent>
            <div className="text-[13px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed whitespace-pre-wrap">
              {dealNotesFreetext}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bonuses not triggered */}
      {calc.bonusesNotTriggered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Bonuses not triggered</CardTitle>
            <CardDescription>
              Structured bonuses on this deal that didn&apos;t hit. Useful when
              the agent asks about a gross threshold or sellout bonus.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-ink-100/80">
            {calc.bonusesNotTriggered.map((b, i) => (
              <div
                key={i}
                className="py-3 flex items-baseline justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-[13px] text-ink-600">{b.label}</div>
                  <div className="text-[11.5px] text-ink-400 mt-0.5">
                    {b.reason}
                  </div>
                </div>
                <div className="text-[12.5px] text-ink-300 font-mono tabular line-through">
                  {b.amount > 0 ? formatMoney(b.amount) : "—"}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function WorksheetRow({
  step,
}: {
  step: { label: string; value: number; note?: string; isSubtotal?: boolean; isDeduction?: boolean };
}) {
  const isNeg = step.value < 0;
  const valueDisplay = formatMoney(Math.abs(step.value));

  return (
    <div
      className={`flex items-start justify-between py-2.5 gap-4 ${step.isSubtotal ? "mt-1" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div
          className={`text-[13px] leading-snug ${
            step.isSubtotal ? "font-semibold text-ink-900" : "text-ink-600"
          }`}
        >
          {step.label}
        </div>
        {step.note && (
          <div className="text-[11.5px] text-ink-400 mt-0.5 max-w-md leading-snug">
            {step.note}
          </div>
        )}
      </div>
      <div
        className={`text-[13.5px] font-mono tabular shrink-0 flex items-center gap-1 ${
          step.isSubtotal
            ? "font-semibold text-ink-900"
            : isNeg || step.isDeduction
              ? "text-rose-700"
              : "text-ink-900"
        }`}
      >
        {(isNeg || step.isDeduction) && (
          <TrendingDown className="h-3 w-3 opacity-60" />
        )}
        {isNeg ? `(${valueDisplay})` : valueDisplay}
      </div>
    </div>
  );
}

function ExpenseBreakdown({
  expenseRows,
}: {
  expenseRows: NonNullable<Awaited<ReturnType<typeof getShowById>>>["expenses"];
}) {
  const passed = expenseRows.filter((e) => !e.absorbedByVenue);
  const absorbed = expenseRows.filter((e) => e.absorbedByVenue);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Expense breakdown</CardTitle>
          <CardDescription>
            Every line the TM might ask about. Absorbed costs don&apos;t come
            off the artist&apos;s payout — they&apos;re the venue&apos;s.
          </CardDescription>
        </div>
        <PlainBadge variant="default">
          {passed.length} passed through
        </PlainBadge>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {passed.map((e) => (
            <div
              key={e.id}
              className="flex items-baseline justify-between py-2 border-b border-ink-100/60 last:border-0 gap-3"
            >
              <div className="min-w-0">
                <div className="text-[13px] text-ink-800 capitalize">
                  {e.description ?? e.category}
                </div>
                <div className="text-[11px] text-ink-400 mt-0.5 capitalize">
                  {e.category}
                </div>
              </div>
              <div className="text-[13px] font-mono tabular text-ink-900 shrink-0">
                {formatMoney(e.amount)}
              </div>
            </div>
          ))}
          {absorbed.length > 0 && (
            <>
              <div className="pt-3 pb-1">
                <div className="eyebrow text-[10px] text-ink-400">
                  Absorbed by venue (not deducted from artist)
                </div>
              </div>
              {absorbed.map((e) => (
                <div
                  key={e.id}
                  className="flex items-baseline justify-between py-2 gap-3 opacity-50"
                >
                  <div className="text-[13px] text-ink-600 capitalize">
                    {e.description ?? e.category}
                  </div>
                  <div className="text-[13px] font-mono tabular text-ink-500 line-through">
                    {formatMoney(e.amount)}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RecoupsSection({ recoups }: { recoups: Recoup[] }) {
  const total = recoups.reduce((s, r) => s + r.amount, 0);
  const disputedTotal = recoups
    .filter((r) => r.status === "disputed")
    .reduce((s, r) => s + r.amount, 0);
  const hasDisputed = disputedTotal > 0;

  return (
    <Card accent={hasDisputed ? "rose" : undefined}>
      <CardHeader>
        <div>
          <CardTitle>Recoups</CardTitle>
          <CardDescription>
            Venue costs taken off the top before artist payment. Often the
            disputed line items in a settlement.
          </CardDescription>
        </div>
        <PlainBadge variant={hasDisputed ? "rose" : "default"}>
          {formatMoney(total)} total
        </PlainBadge>
      </CardHeader>
      <CardContent className="divide-y divide-ink-100/80">
        {recoups.map((r) => (
          <div
            key={r.id}
            className="py-3.5 grid grid-cols-[1fr_auto_auto] items-center gap-3"
          >
            <div className="min-w-0">
              <div className="text-[13px] text-ink-900 leading-tight">
                {r.label}
              </div>
              <div className="text-[11.5px] text-ink-400 mt-0.5">
                {RECOUP_LABELS[r.category]}
              </div>
            </div>
            <div>
              {r.status === "disputed" ? (
                <PlainBadge variant="rose">Disputed</PlainBadge>
              ) : r.status === "withdrawn" ? (
                <PlainBadge variant="default">Withdrawn</PlainBadge>
              ) : (
                <PlainBadge variant="brand">Agreed</PlainBadge>
              )}
            </div>
            <div className="text-[13.5px] font-mono tabular text-ink-900 text-right min-w-[80px]">
              {formatMoney(r.amount)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SignoffSection({
  settlement,
  tmSignedOffPositively,
}: {
  settlement: Settlement;
  tmSignedOffPositively: boolean;
}) {
  return (
    <Card accent={tmSignedOffPositively ? "amber" : undefined}>
      <CardHeader>
        <CardTitle>Sign-off & notes</CardTitle>
        {tmSignedOffPositively && (
          <PlainBadge variant="amber">TM agreed at the table</PlainBadge>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {settlement.signoffText && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              From the artist team (tour manager, at the table)
            </div>
            <div
              className={`text-[13px] text-ink-800 rounded-lg p-4 ring-1 leading-relaxed ${
                tmSignedOffPositively
                  ? "bg-amber-50/40 ring-amber-200/60"
                  : "bg-canvas-soft ring-ink-200/60"
              }`}
            >
              &ldquo;{settlement.signoffText}&rdquo;
            </div>
            {tmSignedOffPositively && (
              <p className="text-[11.5px] text-amber-700 mt-2">
                This is the TM&apos;s in-room agreement. The current
                &ldquo;Disputed&rdquo; status reflects a subsequent challenge
                from the agent — not this sign-off.
              </p>
            )}
          </div>
        )}
        {settlement.notes && (
          <div>
            <div className="eyebrow text-[10px] text-ink-500 mb-2">
              Mariana&apos;s settlement notes
            </div>
            <div className="text-[12.5px] text-ink-800 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed">
              {settlement.notes}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
