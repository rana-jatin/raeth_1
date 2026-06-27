# RAETH Market Rules

## Market Types

RAETH offers three types of markets: perpetual futures, binary options, and parlays.

---

## BTC Perpetual (BTC-PERP)

### Parameters
- **Symbol**: `BTC-PERP`
- **Type**: Linear perpetual future
- **Underlying**: BTC/USD spot price
- **Tick size**: $1.50 (orders must be multiples of $1.50)
- **Min order size**: 0.01 BTC
- **Contract multiplier**: 100 (1 lot = 0.01 BTC)
- **Mark price**: Last traded price, updated on every fill
- **Starting mark**: ~$64,931

### Funding
- **Funding interval**: Hourly
- **Funding rate**: Calculated from the basis between the perpetual mark and the BTC spot price
- **Payment**: Long pays short when mark > spot; short pays long when mark < spot
- **Funding is settled** from/to the margin account every hour

### Margin & Liquidation
- **Margin model**: Cross-margin within the sub-wallet
- **Initial margin**: ~5% of notional (20x max leverage)
- **Maintenance margin**: ~2.5% of notional
- **Liquidation**: Position is forcibly closed if margin falls below maintenance margin
- **ADL (Auto-Deleveraging)**: In extreme conditions, profitable counter-positions may be reduced to cover liquidations

### Order Rules for BTC-PERP
- Side: `BUY` (go long) or `SELL` (go short)
- Limit orders: price in USD, must be a multiple of $1.50
- Market orders: fill at best available price, never rest
- IOC: fill what's available immediately, cancel remainder
- GTC: rest on book until filled or cancelled

### Settlement
- Perpetuals do not expire. Position is held until closed by the trader or liquidated.

---

## BTC Up/Down 5-minute (BTC-UPDOWN)

### Parameters
- **Symbol**: `BTC-UPDOWN`
- **Type**: 5-minute binary option
- **Question**: Will BTC close higher or lower than the current price at the end of the 5-minute window?
- **Settlement currency**: USD
- **Payout**: $1.00 per unit if correct, $0.00 if incorrect
- **Price range**: 0.01 to 0.99 (probability)
- **Tick size**: $0.005
- **Starting mark**: ~0.55 (55% implied probability of UP)
- **Window**: New 5-minute window opens every 5 minutes

### Order Rules for BTC-UPDOWN
- Side: `UP` (bet BTC goes higher) or `DOWN` (bet BTC goes lower)
- Prices are in probability space: 0.55 means you pay $0.55 to win $1.00 on an UP outcome
- Limit orders: specify price in [0.01, 0.99]
- Market orders: fill at the best available price

### Settlement
- At the end of each 5-minute window, BTC's closing price is compared to the opening price
- If BTC closed **higher**: UP positions pay out $1.00/unit; DOWN positions pay out $0.00/unit
- If BTC closed **lower or equal**: DOWN positions pay $1.00/unit; UP positions pay $0.00
- Payout is instantly credited to the sub-wallet
- A new window immediately opens with a fresh order book

### Implied Probability
The mid price of UP orders is the market's implied probability that BTC goes up in the window. A mid of 0.60 means the market thinks there's a 60% chance of UP.

---

## BTC Up/Down 15-minute (BTC-UPDOWN-15)

Same rules as BTC-UPDOWN but over a 15-minute window instead of 5 minutes.

- **Symbol**: `BTC-UPDOWN-15`
- **Window**: 15-minute settlement
- **Starting mark**: ~0.48
- **Tick size**: $0.005
- **Min/max price**: 0.01 to 0.99

---

## BTC Parlay 3-leg (BTC-PARLAY)

### Parameters
- **Symbol**: `BTC-PARLAY`
- **Type**: Multi-window parlay
- **Legs**: 3 consecutive 5-minute windows
- **Payout**: $1.00/unit if BTC goes in the same direction for all 3 windows; $0.00 otherwise
- **Price range**: 0.01 to 0.99
- **Tick size**: $0.005
- **Starting mark**: ~0.21 (21% implied probability that BTC goes the same direction for 3 windows)

### Settlement
- A 3-leg parlay settles after 15 minutes (3 × 5-minute windows)
- All three legs must resolve in the same direction for the payout
- The parlay's probability compounds: if each leg has p=0.55 chance of UP, the parlay has ~0.55³ ≈ 0.166 chance of paying out
- Side `UP` = bet that BTC is UP in all 3 legs; `DOWN` = bet that BTC is DOWN in all 3 legs

---

## General Order Rules (All Markets)

### Price Validation
- All orders must be within a ±10% price band of the current mark price to prevent fat-finger errors
- For binaries/parlays: price must be in [0.01, 0.99]
- For perps: price must be within ±10% of current mark

### Size Limits
- Minimum size: 1 unit (perps: 0.01 BTC equivalent at multiplier 100)
- Maximum size per order: determined by sub-wallet bankroll and leverage limits
- Zero-size orders are **always rejected** (`ZERO_QTY` error)

### Pre-Trade Checks (in order)
1. Size > 0 (reject with `ZERO_QTY` if not)
2. Price within band (reject with `PRICE_BAND` if not)
3. Sufficient available balance (reject with `INSUFFICIENT_BALANCE` if not)
4. Self-trade prevention: orders from the same sub-wallet cannot cross each other

### Priority
- Orders are matched in **price-time (FIFO) priority**: best price first; among equal prices, the earlier-submitted order is filled first.
- The engine never lets the book cross (best bid < best ask is always maintained).

### Fees
- Maker fee (resting order): 0% (zero fee for providing liquidity)
- Taker fee (aggressive order): 0.05% of notional
- Settlement fee: 0% for binaries/parlays

### Sub-Wallet Scoping
- Each API key is scoped to one sub-wallet
- A sub-wallet has its own bankroll, positions, and order history
- A master wallet can spawn multiple sub-wallets with capped bankrolls
- Sub-wallets cannot withdraw to external addresses — bankroll is confined to the exchange
