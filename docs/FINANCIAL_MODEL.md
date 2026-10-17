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
