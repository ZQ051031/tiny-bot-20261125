[![Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![Rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/ZQ051031/tiny-bot-20261125/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![Reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/ZQ051031/tiny-bot-20261125/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

# Tiny Bot — SMA crossover trend-follower for Solana bars

A tiny paper-trading bot for the make.fun competition
[Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1).
It reads hourly bars over the `agent-fun/bars-replay/v1` line protocol (hello,
batch, done on stdin; one reply per batch on stdout) and decides, per asset,
whether to hold it or sit in USDC.

## Strategy

Hold an asset only while its short trend is above its long trend; sit in USDC
the rest of the time. Every symbol in the universe gets the same rule, so the
bot rides whichever asset is trending up and dodges the ones trending down.
Buy-and-hold eats every drawdown — this bot steps aside for the worst of them
and re-enters on the next up-cross.

Per symbol, on each hourly bar close:

- Track SMA(8) and SMA(24) of closes. The slower pair was chosen over a fast
  5/15 pair, which whipsawed on choppy hourly bars: on the dev window it made
  69 trades with a 24% win rate, paid 105 USDC in fees and lost 449.85 USDC.
- **Buy** when SMA(8) crosses above SMA(24) and we hold none of that symbol.
- **Sell** the whole position when SMA(8) crosses back below SMA(24), or when
  the position is down 10% from cost (stop-loss). There is no take-profit:
  after a take-profit exit the bot could not re-enter until a fresh cross,
  which strands it in cash through the rest of a strong rally, so winners run
  until the trend itself turns.
- A bar with zero volume signals nothing.

Sizing is an equal slice of equity per symbol, capped by the harness weight cap
(25% of equity) and by the cash left in the reply. Sells are sent before buys.
Orders fill at the next bar's open, so every decision uses only closed bars.

## Files

- `main.ts` — the bot (standard library only; the bars shim is vendored).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's `sdk/makefun-bars.ts`
  shim that speaks the replay protocol.
- `LICENSE` — MIT.

## Run it

Requires Node 22.18+ (the grader runs Node 22.23.4; TypeScript runs as-is).
Grade locally against the kit's dev window with the kit CLI:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot <repo-dir> --driver process
```

## Local results (dev window, 136 hourly bars)

Measured with the kit's local grader (`grade-local --driver process`, which
runs the bot twice, as the server does; both runs reproduced byte for byte):

| | Net PnL (USDC) |
| --- | --- |
| This bot | **-90.19** |
| Buy-and-hold baseline | -869.34 |

The bot beats buy-and-hold by **+779.15 USDC** on the dev window. Both are
negative because the dev window was a down market (buy-and-hold lost 8.7%);
the bot's edge is dodging most of that drawdown: 31 trades over 7 symbols,
max drawdown 2.7% (vs 10.9% for buy-and-hold), 51.37 USDC in fees, 90%
interval -199.37 to +20.83 USDC. The final window (3 UTC days from the
deadline) is different data, so these numbers are a dev-window check, not a
promise — but the rule is trend-following with a stop-loss, not fitted to any
single bar.
