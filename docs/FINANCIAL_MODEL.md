# Financial Model

All amounts are integers in minor units (e.g. cents). Time is discretised into hourly buckets `t`. Examples use **synthetic numbers**.

## Notation
- `N_t = In_t − Out_t` net flow in bucket t (deposits + settlements in, withdrawals + payouts out).
- `C` cash currently available; `H` planning horizon (hours); `α` miss tolerance (e.g. 0.01).
- Instrument `i`: annual rate `r_i`, settlement lag `d_i` hours, early-withdrawal penalty fraction `p_i`, capacity `K_i`, minimum hold `m_i`.
- `x_i ≥ 0` decision: amount deployed to i.

## Forecast
Baseline: seasonal naive `N̂_t = N_{t−168}` (same hour last week) **[definition: FPP3]**.
Candidate: hour-of-week profile with exponential smoothing: `s_k ← λ·N_t + (1−λ)·s_k` for k = hour-of-week(t); `N̂_{t+h} = s_{k(t+h)}`.
Backtest with rolling origin; residual `e_t = N_t − N̂_t` per horizon h. Empirical residual quantiles give the uncertainty. Compare to baseline by MASE and pinball loss at level α.

## Reserve
Cumulative flow over horizon: `S_H = Σ_{h=1..H} N_{t+h}`. Forecast mean `μ_H = Σ N̂`. Residual quantile `q_H(α)` of `S_H − μ_H` (empirical, from backtest).
```
R = max(0, −(μ_H + q_H(α))) + F + Z
```
`F` operational floor, `Z` stress add-on (worst scenario from the simulator). Liquid cash needed = R.
Tiers: (1) fixed buffer = F; (2) probabilistic = above, holds with ≈ 1−α **under the stationarity assumption**; (3) guarantee = needs committed funding; not modelled.

## Deployable surplus
`Surplus = max(0, C − R)`.

## Objective
Maximise over x:
```
Σ_i x_i · r_i · (H/8760)  −  Σ_i π_i · p_i · x_i  −  λ · E[Shortfall]
```
`π_i` = probability the position must be liquidated early (estimated by simulation: fraction of scenarios where cash < 0 forces redemption). Shortfall cost `λ` = emergency borrowing rate × shortfall × time.

## Constraints
- `Σ x_i ≤ Surplus` (reserve never breached).
- `0 ≤ x_i ≤ K_i`.
- Funds in transit: money in instrument with lag `d_i > h` is not available at hour h; the reserve must be met from instruments with `d_i ≤ h` plus cash.
- Minimum holds `m_i` considered through penalty `p_i` if redeemed earlier.

## Solving
With a linear objective and box/budget constraints, sort instruments by net unit value `v_i = r_i·H/8760 − π_i·p_i` and fill in descending order while `v_i > 0` until Surplus or capacities are exhausted (exact for this LP). `π_i` makes it scenario-dependent; Phase 5 iterates (solve → simulate → update π).

## Metrics
Net yield; penalties paid; shortfall frequency `P(cash<0)`; expected shortfall; emergency borrowing cost; idle cash (hours·amount); all vs baselines (hold-all-cash, fixed-percentage buffer).

## Worked example (synthetic)
C = 50,000,000; H = 4; μ_H = −8,000,000; q_H(0.01) = −6,000,000 (worst-case extra outflow); F = 2,000,000; Z = 0.
R = 8,000,000 + 6,000,000 + 2,000,000 = 16,000,000 → Surplus = 34,000,000.
Instruments: A r=4% K=20M π·p=0.0002; B r=5.5% K=30M π·p=0.0010. Per-4h: A v = 0.04·4/8760 − 0.0002 ≈ 0.0000183−0.0002 < 0 ⇒ **not worth deploying** over a 4-hour horizon. Lesson: short horizons make penalties dominate; the optimiser must allow zero deployment. (Illustrative arithmetic only; not performance evidence.)

## Insufficient funds / low confidence
If `C < R`: Surplus = 0, status `UNDER_RESERVED`, report gap `R − C` and recommend redeeming eligible instruments ranked by lowest penalty. If backtest skill versus baseline is ≤ 0 or residual sample is small, fall back to the baseline forecast with a wider fixed buffer and flag `LOW_CONFIDENCE`.

## Assumptions
Stationary residuals; known instrument terms; no counterparty risk; single currency; independence of rate and flow.

## Stress Scenario Simulator (Phase 18)

The stress scenario simulator evaluates liquidity resilience across synthetic and historical Monte Carlo trials under acute tail stress without look-ahead.

### 1. Scenario Shocks & Parameter Bounds
- **Outflow Shock (`outflowShockPct`, 0–50%)**: Multiplies nominal hourly outflow over an activation window $[t_{\text{start}}, t_{\text{start}} + t_{\text{duration}}]$:
  $$\text{Outflow}_t^{\text{shocked}} = \text{Outflow}_t \cdot \left(1 + \frac{\text{outflowShockPct}}{100}\right)$$
- **Settlement Delay (`settlementDelayHours`, 0–72h)**: Incoming merchant settlements (default: 35% of total inflow) are withheld at hour $t$ and scheduled to arrive in liquidity at $t + \Delta t_{\text{settlement}}$.
- **Correlated Bank-Run Tail (`correlatedRun`)**: Models persistent multi-hour liquidity panics with initial shock intensity $I \in [0, 100]\%$ and hourly exponential decay $\delta \in [0, 1]$:
  $$\text{RunFactor}_\tau = \frac{I}{100} \cdot \delta^\tau \quad \text{where } \tau = t - t_{\text{start}} \ge 0$$
  $$\text{ExtraOutflow}_t = \text{Outflow}_t \cdot \text{RunFactor}_\tau$$
- **Yield Rate Shock (`yieldRateShockBps`, −2000 to +2000 bps)**: Shifts instrument APYs:
  $$r_i^{\text{adj}} = \max\left(0, r_i + \frac{\text{yieldRateShockBps}}{10\,000}\right)$$
- **Instrument Outages (`instrumentOutageIds`)**: A set of frozen instruments that cannot be redeemed during the stress event, testing facility concentration risk.
- **Reserve Confidence (`confidence`, 0.50–0.999)**: The risk tolerance $\alpha = 1 - \text{confidence}$ passed to policy sizing.

### 2. Evaluated Liquidity Policies
Policies are pure functions of information available strictly **prior** to the simulation horizon:
- **`reserve-juggler`**: Dynamically computes probabilistic reserve $R = \max(0, -(\mu_H + q_H(\alpha))) + F$ using EWMA forecast and backtest residuals, allocating surplus to viable instruments via linear net-value ordering.
- **`hold-all-cash`**: Deploys zero cash to yield instruments; keeps 100% liquid cash. Invariant: strictly zero penalties and zero deployed yield.
- **`fixed-buffer`**: Retains a fixed fraction (default: 20%) of cash liquid, allocating remaining funds across instruments sorted by APY descending.

### 3. Liquidation Hierarchy & Emergency Borrowing
When cash goes negative ($C_t < 0$):
1. **Orderly Liquidation**: Eligible holdings (excluding frozen outages) are redeemed using `solveLiquidation` prioritized by:
   - Lowest early withdrawal penalty $\pi_i$, then
   - Fastest settlement speed $d_i$ (hours).
   Proceeds are credited at hour $t + d_i$.
2. **Emergency Borrowing**: If liquid cash remains negative at hour $t$, the remaining deficit is funded via the emergency borrowing facility at annualized rate $\lambda_{\text{borrow}}$ (default 1000 bps = 10% APY):
   $$\text{BorrowingCost}_t = |\min(0, C_t)| \cdot \frac{\lambda_{\text{borrow}}}{8760}$$
   $$\text{TrialShortfall} = \max_{t} |\min(0, C_t)|$$

### 4. Accounting Identities & Precision
- **Cash Conservation Identity**:
  $$C_t = C_{t-1} + \text{Inbound}_t - \text{Outbound}_t + \text{ArrivedLiquidations}_t + \text{ArrivedSettlements}_t - \text{Penalties}_t$$
- **Yield Conservation Identity**:
  $$\text{netYield} = \text{grossYield} - \text{penaltiesPaid} - \text{emergencyBorrowingCost} \quad (\text{exact equality})$$
- All money values use `Money` (BigInt integer minor units, e.g. cents). Rates are converted with explicit round-half-even (banker's rounding) rules. No floating-point balances are used.

### 5. Honest Framing & Disclaimer
All simulation metrics are model outputs on empirical or synthetic inputs, not a financial guarantee. Every simulation result includes a mandatory disclaimer emphasizing that reserve juggler outputs reflect probabilistic estimates under modeled assumptions.

