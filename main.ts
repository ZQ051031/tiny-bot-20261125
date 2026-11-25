// Tiny Bot: SMA crossover trend-follower on hourly bars (agent-fun/bars-replay/v1).
//
// Idea: hold an asset only while its short trend is above its long trend, and sit
// in USDC the rest of the time. Every symbol gets the same rule, so the bot rides
// whichever of the seven assets is trending up and dodges the ones trending down.
// That is the whole edge over buy-and-hold: buy-and-hold eats every drawdown, this
// bot steps aside for the worst of them, then re-enters on the next up-cross.
//
// Rule, per symbol, on each hourly bar close:
//   - Track SMA(8) and SMA(24) of closes. The slower pair whipsaws far less than
//     a fast 5/15 pair on choppy hourly bars (the fast pair made 69 trades with a
//     24% win rate on the dev window and paid 105 USDC in fees).
//   - BUY when SMA(8) crosses above SMA(24) and we hold nothing of that symbol.
//   - SELL the whole position when SMA(8) crosses back below SMA(24), or when the
//     position is down 10% from cost (stop-loss). No take-profit: winners run until
//     the trend itself turns.
//   - A bar with zero volume signals nothing.
// Sizing: an equal slice of equity per symbol (equity / 7), capped by the harness
// weight cap (25% of equity) and by the cash left in this reply. Sells go first so
// a reply never spends proceeds that only land at the next bar's open.
// Orders fill at the next bar's open, so every decision uses only closed bars.
// Deterministic: plain float arithmetic on closes, no clock, no randomness, no
// network, standard library only (plus the vendored bars shim in vendor/).

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST = 8;
const SLOW = 24;
const MAX_SLIPPAGE_BPS = 100;
/** Stop-loss: sell when the position is worth 90% of its cost or less. */
const STOP_NUM = 90n;
const STOP_DEN = 100n;

interface Series {
  closes: number[];
  /** SMA(5) - SMA(15) after the previous bar, once both SMAs exist. */
  prevGap: number | null;
}

const series = new Map<string, Series>();

function sma(values: number[], span: number): number | null {
  if (values.length < span) return null;
  let sum = 0;
  for (let i = values.length - span; i < values.length; i++) sum += values[i];
  return sum / span;
}

function push(symbol: string, close: number): { gap: number | null; prevGap: number | null } {
  let s = series.get(symbol);
  if (s === undefined) {
    s = { closes: [], prevGap: null };
    series.set(symbol, s);
  }
  s.closes.push(close);
  if (s.closes.length > SLOW) s.closes.shift();
  const fast = sma(s.closes, FAST);
  const slow = sma(s.closes, SLOW);
  const gap = fast !== null && slow !== null ? fast - slow : null;
  const prevGap = s.prevGap;
  s.prevGap = gap;
  return { gap, prevGap };
}

/**
 * Exit if the trend turned down, or the stop-loss tripped. No take-profit: after
 * a take-profit exit the bot could not re-enter until a fresh cross, which strands
 * it in cash through the rest of a strong rally, so winners are left to run until
 * the trend itself turns.
 */
function shouldExit(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }, trendDown: boolean): boolean {
  if (trendDown) return true;
  const value = state.value(symbol, held.qty);
  return value * STOP_DEN <= held.cost * STOP_NUM;
}

await runBars({
  onBatch(state, batch) {
    const crossUp = new Set<string>();
    const crossDown = new Set<string>();
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      fresh.add(bar.symbol);
      if (bar.v === '0') continue;
      const { gap, prevGap } = push(bar.symbol, Number(bar.c));
      if (gap === null || prevGap === null) continue;
      if (gap > 0 && prevGap <= 0) crossUp.add(bar.symbol);
      if (gap < 0 && prevGap >= 0) crossDown.add(bar.symbol);
    }
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (shouldExit(state, symbol, held, crossDown.has(symbol))) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else if (crossUp.has(symbol)) {
        entries.push(symbol);
      }
    }
    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = state.hello.symbols.length;
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let cash = state.cash;
    for (const symbol of entries) {
      if (orders.length >= caps.max_orders_per_bar) break;
      const room = state.weightRoom(symbol);
      let slice = stake < byWeight ? stake : byWeight;
      if (slice > room) slice = room;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) continue;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
    }
    return orders;
  },
});
