/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * Supports:
 *   1. flat                 — $X guaranteed, optional bonuses
 *   2. percentage_of_gross  — X% of gross, optional bonuses
 *   3. vs                   — guarantee vs % of net (or gross), whichever greater
 *   4. percentage_of_net    — X% of net after expenses (no guarantee floor)
 *   5. door                 — artist takes all ticket revenue minus capped expenses
 *
 * All supported types include step-by-step breakdown so TMs and agents
 * can verify every line at the table and the next morning.
 */

import type { Deal, Expense, TicketSale, Bonus } from "@/db/schema";

export type CalculationStep = {
  label: string;
  value: number;
  note?: string;
  isSubtotal?: boolean;
  isDeduction?: boolean;
};

export type SettlementCalculation =
  | {
      supported: true;
      grossBoxOffice: number;
      netBoxOffice: number;
      totalExpenses: number;
      cappedExpenses: number;
      totalToArtist: number;
      steps: CalculationStep[];
      finalFormula: string;
      bonusesApplied: { label: string; amount: number; reason: string }[];
      bonusesNotTriggered: { label: string; amount: number; reason: string }[];
      // Which calculation path won (for vs deals)
      vsWinner?: "guarantee" | "percentage";
      vsGuarantee?: number;
      vsPercentagePayout?: number;
      // Data health flags — caller decides how to surface these
      healthWarnings: DealHealthWarning[];
    }
  | {
      supported: false;
      reason: string;
      dealType: Deal["dealType"];
      healthWarnings: DealHealthWarning[];
    };

export type DealHealthWarning = {
  severity: "warn" | "info";
  code: string;
  message: string;
  detail?: string;
};

interface CalcInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  venueCapacity?: number;
  ticketsSold?: number;
}

export function parseBonuses(deal: Deal): Bonus[] {
  if (!deal.bonusesJson) return [];
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Inspect the freetext notes for signals that the structured fields may be
 * stale or that the deal was renegotiated after initial entry.
 */
export function detectDealHealthWarnings(deal: Deal): DealHealthWarning[] {
  const warnings: DealHealthWarning[] = [];
  const notes = (deal.dealNotesFreetext ?? "").toLowerCase();

  const staleSignals = [
    "renegotiated",
    "updated",
    "structured field still reflects",
    "confirm before settlement",
    "phone call with agent",
    "was ",
  ];
  const hasStaleSignal = staleSignals.some((s) => notes.includes(s));

  if (hasStaleSignal) {
    warnings.push({
      severity: "warn",
      code: "stale_structured_fields",
      message: "Deal terms may have changed since initial entry",
      detail:
        "The deal notes mention a renegotiation or update. Verify the structured fields " +
        "(guarantee, percentage, expense cap) match the final agreed terms before settling.",
    });
  }

  // Freetext mentions a % that differs from the stored percentage field
  const pctMatch = notes.match(/(\d+)\/(\d+)/);
  if (pctMatch && deal.percentage != null) {
    const fractionPct = parseInt(pctMatch[1]) / 100;
    const storedPct = deal.percentage;
    // Tolerance: >2 percentage points difference
    if (Math.abs(fractionPct - storedPct) > 0.02) {
      warnings.push({
        severity: "warn",
        code: "pct_mismatch",
        message: `Percentage mismatch: deal notes say ${pctMatch[1]}%, structured field stores ${(storedPct * 100).toFixed(0)}%`,
        detail:
          "This is a common source of settlement disputes. Confirm which number is correct with the deal email.",
      });
    }
  }

  return warnings;
}

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, ticketSales, expenses, venueCapacity, ticketsSold } = input;

  const healthWarnings = detectDealHealthWarnings(deal);

  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;
  const totalExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);

  // Expenses after applying the cap (if any)
  const cappedExpenses =
    deal.expenseCap != null
      ? Math.min(totalExpenses, deal.expenseCap)
      : totalExpenses;

  const tickets =
    ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);

  // ------------------------------------------------------------------ flat --
  if (deal.dealType === "flat") {
    if (deal.guaranteeAmount == null) {
      return {
        supported: false,
        reason: "Flat deal is missing a guarantee amount.",
        dealType: deal.dealType,
        healthWarnings,
      };
    }
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      cappedExpenses,
      totalToArtist: deal.guaranteeAmount + bonusResult.totalApplied,
      steps: [
        {
          label: "Flat guarantee",
          value: deal.guaranteeAmount,
          note: "No expense deductions. The guarantee is the floor.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `flat ${deal.guaranteeAmount} + bonuses ${bonusResult.totalApplied} = ${(deal.guaranteeAmount + bonusResult.totalApplied).toFixed(2)}`
        : `flat guarantee = ${deal.guaranteeAmount}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
      healthWarnings,
    };
  }

  // --------------------------------------------------- percentage of gross --
  if (deal.dealType === "percentage_of_gross") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-gross deal is missing a percentage.",
        dealType: deal.dealType,
        healthWarnings,
      };
    }
    const payout = grossBoxOffice * deal.percentage;
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      cappedExpenses,
      totalToArtist: payout + bonusResult.totalApplied,
      steps: [
        { label: "Gross box office", value: grossBoxOffice },
        {
          label: `× ${(deal.percentage * 100).toFixed(0)}%`,
          value: payout,
          note: "Percentage of gross — no expense deductions.",
          isSubtotal: true,
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `gross × ${deal.percentage} + bonuses = ${(payout + bonusResult.totalApplied).toFixed(2)}`
        : `gross × ${deal.percentage} = ${payout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
      healthWarnings,
    };
  }

  // ------------------------------------------------------ percentage of net --
  if (deal.dealType === "percentage_of_net") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-net deal is missing a percentage.",
        dealType: deal.dealType,
        healthWarnings,
      };
    }

    const netAfterExpenses = netBoxOffice - cappedExpenses;
    const pct = deal.percentage;
    const payout = Math.max(0, netAfterExpenses) * pct;

    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    const steps: CalculationStep[] = [
      { label: "Gross box office", value: grossBoxOffice },
      { label: "Less: platform / CC fees", value: -totalFees, isDeduction: true },
      { label: "Net box office", value: netBoxOffice, isSubtotal: true },
      {
        label: "Less: passthrough expenses",
        value: -cappedExpenses,
        isDeduction: true,
        note:
          deal.expenseCap != null && totalExpenses > deal.expenseCap
            ? `Actual expenses $${totalExpenses.toFixed(2)} capped at $${deal.expenseCap.toFixed(2)}`
            : undefined,
      },
      {
        label: "Net after expenses",
        value: netAfterExpenses,
        isSubtotal: true,
      },
      {
        label: `× ${(pct * 100).toFixed(0)}% of net`,
        value: payout,
        isSubtotal: true,
      },
      ...bonusResult.applied.map((b) => ({
        label: b.label,
        value: b.amount,
        note: b.reason,
      })),
    ];

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      cappedExpenses,
      totalToArtist: payout + bonusResult.totalApplied,
      steps,
      finalFormula: `${(pct * 100).toFixed(0)}% × (gross ${grossBoxOffice.toFixed(2)} − fees ${totalFees.toFixed(2)} − exp ${cappedExpenses.toFixed(2)}) = ${payout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
      healthWarnings,
    };
  }

  // ----------------------------------------------- vs (guarantee vs % net) --
  if (deal.dealType === "vs") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Vs deal is missing a percentage.",
        dealType: deal.dealType,
        healthWarnings,
      };
    }

    // Check whether this is a vs-gross or vs-net deal
    const isVsGross = deal.percentageBasis === "gross";

    // Find a tier ratchet in bonuses, if present — it overrides the base %
    const bonuses = parseBonuses(deal);
    const tierRatchet = bonuses.find((b) => b.type === "tier_ratchet");
    const otherBonuses = bonuses.filter((b) => b.type !== "tier_ratchet");

    // Determine the effective percentage (ratchet overrides base)
    let effectivePct = deal.percentage;
    let ratchetNote: string | undefined;
    if (tierRatchet && tierRatchet.type === "tier_ratchet" && venueCapacity) {
      const fillRate = tickets / venueCapacity;
      const applicableTier = [...tierRatchet.tiers]
        .sort((a, b) => b.from - a.from)
        .find((t) => fillRate >= t.from);
      if (applicableTier) {
        effectivePct = applicableTier.percentage;
        ratchetNote = `Fill rate ${(fillRate * 100).toFixed(0)}% → tier applies ${(effectivePct * 100).toFixed(0)}%`;
      }
    }

    const basis = isVsGross ? grossBoxOffice : netBoxOffice - cappedExpenses;
    const percentagePayout = Math.max(0, basis) * effectivePct;
    const guarantee = deal.guaranteeAmount ?? 0;

    const vsWinner: "guarantee" | "percentage" =
      percentagePayout >= guarantee ? "percentage" : "guarantee";
    const basePayout = Math.max(guarantee, percentagePayout);

    // Non-ratchet bonuses (gross thresholds, sellouts, walkout pots)
    const bonusResult = applyBonuses(otherBonuses, {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    const pctLabel = `${(effectivePct * 100).toFixed(0)}% of ${isVsGross ? "gross" : "net"}`;

    const steps: CalculationStep[] = [
      { label: "Gross box office", value: grossBoxOffice },
      { label: "Less: platform / CC fees", value: -totalFees, isDeduction: true },
      { label: "Net box office", value: netBoxOffice, isSubtotal: true },
    ];

    if (!isVsGross) {
      steps.push({
        label: "Less: passthrough expenses",
        value: -cappedExpenses,
        isDeduction: true,
        note:
          deal.expenseCap != null && totalExpenses > deal.expenseCap
            ? `Actual expenses $${totalExpenses.toFixed(2)} capped at $${deal.expenseCap.toFixed(2)}`
            : deal.expenseCap != null
              ? `Expense cap: $${deal.expenseCap.toFixed(2)}`
              : undefined,
      });
      steps.push({
        label: "Net after expenses",
        value: basis,
        isSubtotal: true,
      });
    }

    steps.push({
      label: pctLabel,
      value: percentagePayout,
      note: ratchetNote ?? (tierRatchet ? "Tier ratchet applies — see bonuses" : undefined),
    });

    if (guarantee > 0) {
      steps.push({
        label: "Guarantee",
        value: guarantee,
        note: `Artist takes the higher of guarantee vs ${pctLabel}`,
      });
      steps.push({
        label:
          vsWinner === "percentage"
            ? `${pctLabel} wins (≥ guarantee)`
            : `Guarantee wins (> ${pctLabel})`,
        value: basePayout,
        isSubtotal: true,
        note:
          vsWinner === "percentage"
            ? `${percentagePayout.toFixed(2)} ≥ ${guarantee.toFixed(2)}`
            : `${guarantee.toFixed(2)} > ${percentagePayout.toFixed(2)}`,
      });
    }

    for (const b of bonusResult.applied) {
      steps.push({ label: b.label, value: b.amount, note: b.reason });
    }

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      cappedExpenses,
      totalToArtist: basePayout + bonusResult.totalApplied,
      steps,
      finalFormula: guarantee > 0
        ? `max(guarantee $${guarantee.toFixed(2)}, ${(effectivePct * 100).toFixed(0)}% × ${isVsGross ? "gross" : "net"} $${basis.toFixed(2)}) = $${basePayout.toFixed(2)}`
        : `${(effectivePct * 100).toFixed(0)}% × ${isVsGross ? "gross" : "net"} $${basis.toFixed(2)} = $${basePayout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: [
        ...(tierRatchet && !venueCapacity
          ? [
              {
                label: tierRatchet.label,
                amount: 0,
                reason: "Capacity unknown — tier ratchet can't be evaluated",
              },
            ]
          : []),
        ...bonusResult.notTriggered,
      ],
      vsWinner,
      vsGuarantee: guarantee,
      vsPercentagePayout: percentagePayout,
      healthWarnings,
    };
  }

  // ------------------------------------------------------------------ door --
  if (deal.dealType === "door") {
    // Door deal: artist takes all ticket revenue minus (capped) expenses.
    // No guarantee, no percentage split — venue keeps nothing from tickets.
    const doorPayout = Math.max(0, grossBoxOffice - cappedExpenses);

    const steps: CalculationStep[] = [
      {
        label: "Gross box office",
        value: grossBoxOffice,
        note: "Artist takes 100% of ticket revenue (door deal).",
      },
      {
        label: "Less: expenses",
        value: -cappedExpenses,
        isDeduction: true,
        note:
          deal.expenseCap != null && totalExpenses > deal.expenseCap
            ? `Actual expenses $${totalExpenses.toFixed(2)} capped at $${deal.expenseCap.toFixed(2)}`
            : deal.expenseCap != null
              ? `Expense cap: $${deal.expenseCap.toFixed(2)}`
              : "No expense cap — all expenses passed through",
      },
      {
        label: "Artist payout",
        value: doorPayout,
        isSubtotal: true,
      },
    ];

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      cappedExpenses,
      totalToArtist: doorPayout,
      steps,
      finalFormula: `gross $${grossBoxOffice.toFixed(2)} − expenses $${cappedExpenses.toFixed(2)} = $${doorPayout.toFixed(2)}`,
      bonusesApplied: [],
      bonusesNotTriggered: [],
      healthWarnings,
    };
  }

  // -------------------------------------------------------- fallback (none) --
  return {
    supported: false,
    dealType: deal.dealType,
    reason: `${deal.dealType} deals aren't handled by the calculator.`,
    healthWarnings,
  };
}

// ------------------------------------------------------------------ helpers --

/** Evaluate a list of bonuses against the show's actual numbers. */
function applyBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
) {
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      if (ctx.gross >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross $${ctx.gross.toLocaleString()} ≥ threshold $${b.threshold.toLocaleString()}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross $${ctx.gross.toLocaleString()} < threshold $${b.threshold.toLocaleString()}`,
        });
      }
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} of ${ctx.capacity} sold (≥95%)`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason:
            ctx.capacity != null
              ? `${ctx.tickets} of ${ctx.capacity} sold — sellout needs ≥95%`
              : "Capacity unknown — can't evaluate sellout",
        });
      }
    } else if (b.type === "attendance_threshold") {
      if (ctx.tickets >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} tickets ≥ ${b.threshold}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} tickets < ${b.threshold}`,
        });
      }
    } else if (b.type === "tier_ratchet") {
      // Tier ratchets are handled inline in the vs-deal path above.
      // If we get here it means we're in a non-vs deal with a ratchet — rare, skip.
      notTriggered.push({
        label: b.label,
        amount: 0,
        reason: "Tier ratchet only applies to vs deals",
      });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((s, b) => s + b.amount, 0),
  };
}
