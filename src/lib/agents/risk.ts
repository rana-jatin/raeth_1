/**
 * Agent Risk Firewall (#5).
 *
 * `evaluateRisk` is the pre-trade gate the runner calls before every
 * submission. It computes the order's notional / leverage / loss budget and
 * raises alerts for overtrading, repeated failed trades, leverage and drawdown
 * breaches, and suspicious churn. Any "block" alert (or a paused agent) stops
 * the order from ever reaching the book.
 */

import type { BotState, DecisionDraft, RiskAlert, RiskVerdict, Side } from "./types";
import { maxDrawdown, ordersInWindow } from "./metrics";

/** Number of frames within which a direction reversal counts as a flip-flop. */
const FLIP_WINDOW_FRAMES = 4;

export function riskLimitLabel(state: BotState): string {
  return `≤${(state.limits.riskPct * 100).toFixed(0)}% bankroll · ${state.limits.maxLeverage}×`;
}

export function evaluateRisk(
  draft: DecisionDraft,
  state: BotState,
  now: number = Date.now(),
): RiskVerdict {
  const notional = Math.abs(draft.px * draft.qty);
  const leverage = notional / Math.max(1, state.bankroll);
  const margin = notional / Math.max(1, state.limits.maxLeverage);
  const maxLossUsd = state.bankroll * state.limits.riskPct;
  const alerts: RiskAlert[] = [];

  if (state.paused) {
    alerts.push({ kind: "suspicious", severity: "block", message: "Agent is paused." });
  }

  const ot = ordersInWindow(state, now);
  if (ot >= state.limits.maxOrdersPerWindow) {
    alerts.push({
      kind: "overtrading",
      severity: "block",
      message: `Overtrading: ${ot} orders in ${state.limits.windowMs / 1000}s (cap ${state.limits.maxOrdersPerWindow}).`,
    });
  } else if (ot >= state.limits.maxOrdersPerWindow - 1) {
    alerts.push({
      kind: "overtrading",
      severity: "warn",
      message: `Approaching order-rate cap (${ot}/${state.limits.maxOrdersPerWindow}).`,
    });
  }

  if (state.counters.consecutiveRejects >= state.limits.maxConsecutiveRejects) {
    alerts.push({
      kind: "repeated_failures",
      severity: "block",
      message: `${state.counters.consecutiveRejects} consecutive rejected orders — halting.`,
    });
  } else if (state.counters.consecutiveRejects >= 2) {
    alerts.push({
      kind: "repeated_failures",
      severity: "warn",
      message: `${state.counters.consecutiveRejects} rejects in a row.`,
    });
  }

  const dd = maxDrawdown(state.pnlHistory);
  if (dd >= state.limits.maxDrawdownUsd) {
    alerts.push({
      kind: "max_loss",
      severity: "block",
      message: `Drawdown $${dd.toFixed(0)} ≥ limit $${state.limits.maxDrawdownUsd}.`,
    });
  } else if (dd >= state.limits.maxDrawdownUsd * 0.7) {
    alerts.push({
      kind: "max_loss",
      severity: "warn",
      message: `Drawdown $${dd.toFixed(0)} nearing limit.`,
    });
  }

  if (leverage > state.limits.maxLeverage) {
    alerts.push({
      kind: "leverage",
      severity: "block",
      message: `Leverage ${leverage.toFixed(1)}× exceeds cap ${state.limits.maxLeverage}×.`,
    });
  } else if (leverage > state.limits.maxLeverage * 0.8) {
    alerts.push({
      kind: "leverage",
      severity: "warn",
      message: `Leverage ${leverage.toFixed(1)}× near cap.`,
    });
  }

  if (margin > state.available) {
    alerts.push({
      kind: "max_loss",
      severity: "block",
      message: `Required margin $${margin.toFixed(0)} exceeds available $${state.available.toFixed(0)}.`,
    });
  }

  if (state.counters.flipFlops >= 4) {
    alerts.push({
      kind: "suspicious",
      severity: "warn",
      message: `${state.counters.flipFlops} rapid direction flips — possible churn.`,
    });
  }

  const allow = !alerts.some((a) => a.severity === "block");
  return { allow, notional, maxLossUsd, leverage, riskLimit: riskLimitLabel(state), alerts };
}

// ── Pure counter transitions (return a new BotState) ──────────────────────────

export function withSubmissionRecorded(
  state: BotState,
  side: Side,
  frameId: number,
  now: number = Date.now(),
): BotState {
  const flipped =
    state.counters.lastSide !== null &&
    state.counters.lastSide !== side &&
    frameId - state.counters.lastSideFrame <= FLIP_WINDOW_FRAMES;
  return {
    ...state,
    lastDecisionAt: now,
    counters: {
      ...state.counters,
      orderTimestamps: [...state.counters.orderTimestamps, now].filter(
        (t) => now - t <= state.limits.windowMs,
      ),
      consecutiveRejects: 0,
      lastSide: side,
      lastSideFrame: frameId,
      flipFlops: state.counters.flipFlops + (flipped ? 1 : 0),
    },
  };
}

export function withRejectRecorded(state: BotState): BotState {
  return {
    ...state,
    counters: { ...state.counters, consecutiveRejects: state.counters.consecutiveRejects + 1 },
  };
}

export function withBlockedRecorded(state: BotState, now: number = Date.now()): BotState {
  return {
    ...state,
    lastDecisionAt: now,
    counters: { ...state.counters, blockedCount: state.counters.blockedCount + 1 },
  };
}

/**
 * Behavioral alerts that depend only on a bot's history (no candidate order):
 * overtrading, repeated failures, drawdown, and churn. Used by the Risk
 * Firewall panel to show a bot's standing risk posture.
 */
export function behavioralAlerts(state: BotState, now: number = Date.now()): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const ot = ordersInWindow(state, now);
  if (ot >= state.limits.maxOrdersPerWindow) {
    alerts.push({
      kind: "overtrading",
      severity: "block",
      message: `Overtrading: ${ot}/${state.limits.maxOrdersPerWindow} orders in window.`,
    });
  } else if (ot >= state.limits.maxOrdersPerWindow - 1) {
    alerts.push({
      kind: "overtrading",
      severity: "warn",
      message: `Order rate ${ot}/${state.limits.maxOrdersPerWindow}.`,
    });
  }
  if (state.counters.consecutiveRejects >= state.limits.maxConsecutiveRejects) {
    alerts.push({
      kind: "repeated_failures",
      severity: "block",
      message: `${state.counters.consecutiveRejects} consecutive rejects.`,
    });
  } else if (state.counters.consecutiveRejects >= 2) {
    alerts.push({
      kind: "repeated_failures",
      severity: "warn",
      message: `${state.counters.consecutiveRejects} rejects in a row.`,
    });
  }
  const dd = maxDrawdown(state.pnlHistory);
  if (dd >= state.limits.maxDrawdownUsd) {
    alerts.push({
      kind: "max_loss",
      severity: "block",
      message: `Drawdown $${dd.toFixed(0)} ≥ limit $${state.limits.maxDrawdownUsd}.`,
    });
  } else if (dd >= state.limits.maxDrawdownUsd * 0.7) {
    alerts.push({
      kind: "max_loss",
      severity: "warn",
      message: `Drawdown $${dd.toFixed(0)} nearing limit.`,
    });
  }
  if (state.counters.flipFlops >= 4) {
    alerts.push({
      kind: "suspicious",
      severity: "warn",
      message: `${state.counters.flipFlops} rapid direction flips.`,
    });
  }
  return alerts;
}
