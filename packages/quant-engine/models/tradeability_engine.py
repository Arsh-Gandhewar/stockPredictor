"""
Point-in-Time Tradeability & Net-Alpha Economic Gating Engine.
============================================================
Translates raw statistical return predictions into executable tradeability decisions:
1. Deducts realistic institutional round-trip friction (brokerage, STT, exchange, stamp).
2. Estimates asset-specific volatility-scaled slippage and market impact.
3. Computes statistical standard error and confidence buffer.
4. Enforces a strict economic hurdle:
     ExpectedNetAlpha > TotalFriction + RiskBuffer + ConfidenceHurdle
5. Fails closed to Cash when positive net alpha cannot be demonstrated with confidence.
"""

import math
import numpy as np
import pandas as pd
from dataclasses import dataclass, asdict
from typing import Dict, List, Any, Optional, Tuple


@dataclass(frozen=True)
class TradeabilityAssessment:
    """
    Immutable audit record representing the tradeability determination for a security.
    """
    ticker: str
    date: str
    expected_gross_excess: float
    base_friction: float
    expected_slippage: float
    total_friction: float
    expected_net_alpha: float
    horizon_volatility: float
    uncertainty: float
    risk_buffer: float
    hurdle: float
    net_edge_over_hurdle: float
    is_tradeable: bool
    calibrated_prob: float
    ineligibility_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class TradeabilityGatingEngine:
    """
    Point-in-time tradeability and net-alpha gating engine.
    Ensures trading occurs ONLY when edge decisively exceeds total friction and risk.
    """

    def __init__(
        self,
        base_friction_rate: float = 0.0013,        # 13 bps institutional round-trip
        risk_buffer_lambda: float = 0.08,          # Multiplier on horizon volatility
        confidence_z: float = 0.84,                # ~80% one-sided confidence hurdle
        min_probability_hurdle: float = 0.48,      # Minimum calibrated probability
        benchmark_vol_ref: float = 0.22            # NIFTY reference annualized volatility
    ):
        self.base_friction_rate = base_friction_rate
        self.risk_buffer_lambda = risk_buffer_lambda
        self.confidence_z = confidence_z
        self.min_probability_hurdle = min_probability_hurdle
        self.benchmark_vol_ref = benchmark_vol_ref

    def compute_slippage(self, annualized_vol: float) -> float:
        """
        Computes expected round-trip slippage scaled by asset volatility relative to market.
        Floor: 5 bps, Ceiling: 25 bps.
        """
        vol = max(0.05, float(annualized_vol))
        ratio = vol / self.benchmark_vol_ref
        slippage = 0.0010 * np.clip(ratio, 0.5, 2.5)
        return float(slippage)

    def evaluate_candidate(
        self,
        ticker: str,
        date_str: str,
        expected_excess_return: float,
        horizon_volatility: float,
        calibrated_prob: float,
        annualized_vol: Optional[float] = None,
        regime_hurdle_multiplier: float = 1.0,
        sample_count: int = 20,
        adv20: Optional[float] = None,
        min_adv: float = 5000000.0  # 50 Lakh INR minimum daily turnover
    ) -> TradeabilityAssessment:
        """
        Evaluates a single candidate under strict economic gating rules.
        """
        # 1. Volatility estimation
        h_vol = max(0.005, float(horizon_volatility))
        ann_vol = float(annualized_vol) if annualized_vol is not None and not np.isnan(annualized_vol) else h_vol * np.sqrt(252.0 / 5.0)

        # 2. Friction breakdown
        slippage = self.compute_slippage(ann_vol)
        total_friction = self.base_friction_rate + slippage

        # 3. Expected net alpha
        exp_gross = float(expected_excess_return)
        exp_net = exp_gross - total_friction

        # 4. Uncertainty & Risk Buffer
        # Effective SE of predicted return: horizon_vol / sqrt(N_eff)
        n_eff = max(5, int(sample_count))
        se_pred = h_vol / np.sqrt(n_eff)
        uncertainty = float(self.confidence_z * se_pred)
        risk_buffer = float(self.risk_buffer_lambda * h_vol)

        # 5. Combined hurdle with regime multiplier
        hurdle = (total_friction + risk_buffer + uncertainty) * float(regime_hurdle_multiplier)
        net_edge = exp_gross - hurdle

        # 6. Gating Logic
        p_cal = float(calibrated_prob)
        is_tradeable = True
        reason = None

        if adv20 is not None and adv20 < min_adv:
            is_tradeable = False
            reason = "INSUFFICIENT_LIQUIDITY"
        elif exp_net <= 0.0:
            is_tradeable = False
            reason = "NEGATIVE_NET_ALPHA"
        elif exp_gross < hurdle:
            is_tradeable = False
            reason = "BELOW_CONFIDENCE_HURDLE"
        elif p_cal < (self.min_probability_hurdle * min(1.15, regime_hurdle_multiplier)):
            is_tradeable = False
            reason = "LOW_CALIBRATED_PROBABILITY"

        return TradeabilityAssessment(
            ticker=ticker,
            date=date_str,
            expected_gross_excess=exp_gross,
            base_friction=self.base_friction_rate,
            expected_slippage=slippage,
            total_friction=total_friction,
            expected_net_alpha=exp_net,
            horizon_volatility=h_vol,
            uncertainty=uncertainty,
            risk_buffer=risk_buffer,
            hurdle=hurdle,
            net_edge_over_hurdle=net_edge,
            is_tradeable=is_tradeable,
            calibrated_prob=p_cal,
            ineligibility_reason=reason
        )

    def filter_and_rank_tradeables(
        self,
        candidates: List[Dict[str, Any]],
        date_str: str,
        regime_hurdle_multiplier: float = 1.0,
        max_picks: int = 3
    ) -> Tuple[List[Dict[str, Any]], List[TradeabilityAssessment], float]:
        """
        Applies economic gating across all candidate opportunities for a given decision date.
        Returns:
            qualifying_candidates: List of candidates passing all tradeability hurdles (up to max_picks).
            all_assessments: Complete audit trail for all evaluated candidates.
            cash_fraction: Fraction of portfolio that must remain in Cash due to unfilled slots.
        """
        assessments: List[TradeabilityAssessment] = []
        tradeable_cands: List[Dict[str, Any]] = []

        for cand in candidates:
            tkr = cand['ticker']
            exp_ret = cand.get('expectedReturn', cand.get('expectedExcessReturn', 0.0))
            h_vol = cand.get('expectedRisk', 0.02)
            p_cal = cand.get('calibratedProbability', cand.get('pred_prob', 0.50))
            ann_vol = cand.get('vol_20d', cand.get('annualized_volatility', None))
            adv = cand.get('adv20', cand.get('ADV', None))

            assessment = self.evaluate_candidate(
                ticker=tkr,
                date_str=date_str,
                expected_excess_return=exp_ret,
                horizon_volatility=h_vol,
                calibrated_prob=p_cal,
                annualized_vol=ann_vol,
                regime_hurdle_multiplier=regime_hurdle_multiplier,
                adv20=adv
            )
            assessments.append(assessment)

            if assessment.is_tradeable:
                cand_copy = dict(cand)
                cand_copy['tradeability'] = assessment.to_dict()
                cand_copy['net_edge_over_hurdle'] = assessment.net_edge_over_hurdle
                tradeable_cands.append(cand_copy)

        # Sort tradeables by net edge over hurdle
        tradeable_cands.sort(key=lambda x: (-x['net_edge_over_hurdle'], x['ticker']))
        selected = tradeable_cands[:max_picks]

        # Sizing and Cash allocation:
        # If fewer than max_picks pass, the remaining portion is allocated to Cash
        n_selected = len(selected)
        cash_fraction = max(0.0, float(max_picks - n_selected) / float(max_picks))

        return selected, assessments, cash_fraction
