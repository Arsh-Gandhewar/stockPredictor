"""
Single Source of Truth for Market Regime Policy Configuration.
Defines exposure limits, EV hurdle multipliers, risk budgets, and holding policies
conditioned on the point-in-time market regime.
"""
from dataclasses import dataclass, field, asdict
from typing import Dict, Any, Optional

@dataclass(frozen=True)
class RegimePolicy:
    """
    Immutable policy configuration for a specific market regime.
    """
    regime: str
    maxExposure: float = 1.0          # Effective gross exposure ceiling (0.0 to 1.0)
    riskBudget: float = 0.01           # Max risk / sizing allocation per trade
    evThresholdMultiplier: float = 1.0 # Minimum EV hurdle multiplier (>= 1.0)
    holdingPeriod: Optional[int] = None # Optional regime-specific holding days
    allowNewTrades: bool = True       # If False, hard NO_TRADE gate
    minimumLiquidityAdv: float = 1000000.0 # Min required 20d ADV
    policyVersion: str = "v5.0.0-regime-policy"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

@dataclass
class RegimePolicyConfig:
    """
    Master configuration governing all market regimes with hysteresis and transition rules.
    """
    policyId: str
    version: str = "v5.0.0-regime-master"
    policies: Dict[str, RegimePolicy] = field(default_factory=dict)
    hysteresisDays: int = 1
    transitionBufferDays: int = 0

    def get_policy(self, regime: str) -> RegimePolicy:
        """Returns policy for the active regime with fail-closed neutral fallback."""
        if regime in self.policies:
            return self.policies[regime]
        return RegimePolicy(regime=regime, maxExposure=1.0, riskBudget=0.01, evThresholdMultiplier=1.0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'policyId': self.policyId,
            'version': self.version,
            'hysteresisDays': self.hysteresisDays,
            'transitionBufferDays': self.transitionBufferDays,
            'policies': {k: v.to_dict() for k, v in self.policies.items()}
        }

# ============================================================
# STANDARD VALIDATION CANDIDATE REGIME POLICIES
# ============================================================

def build_baseline_policy() -> RegimePolicyConfig:
    """POLICY A: Unconstrained baseline (100% exposure across all regimes, no trade restrictions)."""
    return RegimePolicyConfig(
        policyId="POLICY_A_BASELINE_NO_REGIME",
        policies={
            'BULL': RegimePolicy('BULL', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True),
            'SIDEWAYS': RegimePolicy('SIDEWAYS', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True),
            'BEAR': RegimePolicy('BEAR', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True),
            'HIGH_VOLATILITY': RegimePolicy('HIGH_VOLATILITY', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True),
            'PANIC': RegimePolicy('PANIC', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True)
        }
    )

def build_high_vol_reduction_policy() -> RegimePolicyConfig:
    """POLICY B: Reduce max gross exposure to 50% during HIGH_VOLATILITY."""
    return RegimePolicyConfig(
        policyId="POLICY_B_HIGH_VOL_REDUCTION",
        policies={
            'BULL': RegimePolicy('BULL', maxExposure=1.0, evThresholdMultiplier=1.0),
            'SIDEWAYS': RegimePolicy('SIDEWAYS', maxExposure=1.0, evThresholdMultiplier=1.0),
            'BEAR': RegimePolicy('BEAR', maxExposure=1.0, evThresholdMultiplier=1.0),
            'HIGH_VOLATILITY': RegimePolicy('HIGH_VOLATILITY', maxExposure=0.50, evThresholdMultiplier=1.0),
            'PANIC': RegimePolicy('PANIC', maxExposure=1.0, evThresholdMultiplier=1.0)
        }
    )

def build_panic_reduction_policy() -> RegimePolicyConfig:
    """POLICY C: Reduce max gross exposure to 25% during PANIC."""
    return RegimePolicyConfig(
        policyId="POLICY_C_PANIC_REDUCTION",
        policies={
            'BULL': RegimePolicy('BULL', maxExposure=1.0, evThresholdMultiplier=1.0),
            'SIDEWAYS': RegimePolicy('SIDEWAYS', maxExposure=1.0, evThresholdMultiplier=1.0),
            'BEAR': RegimePolicy('BEAR', maxExposure=1.0, evThresholdMultiplier=1.0),
            'HIGH_VOLATILITY': RegimePolicy('HIGH_VOLATILITY', maxExposure=1.0, evThresholdMultiplier=1.0),
            'PANIC': RegimePolicy('PANIC', maxExposure=0.25, evThresholdMultiplier=1.0)
        }
    )

def build_bear_ev_increase_policy() -> RegimePolicyConfig:
    """POLICY D: Increase required expected value by 1.5x in BEAR."""
    return RegimePolicyConfig(
        policyId="POLICY_D_BEAR_EV_INCREASE",
        policies={
            'BULL': RegimePolicy('BULL', maxExposure=1.0, evThresholdMultiplier=1.0),
            'SIDEWAYS': RegimePolicy('SIDEWAYS', maxExposure=1.0, evThresholdMultiplier=1.0),
            'BEAR': RegimePolicy('BEAR', maxExposure=1.0, evThresholdMultiplier=1.50),
            'HIGH_VOLATILITY': RegimePolicy('HIGH_VOLATILITY', maxExposure=1.0, evThresholdMultiplier=1.0),
            'PANIC': RegimePolicy('PANIC', maxExposure=1.0, evThresholdMultiplier=1.0)
        }
    )

def build_sideways_ev_increase_policy() -> RegimePolicyConfig:
    """POLICY E: Increase required expected value by 1.25x in SIDEWAYS."""
    return RegimePolicyConfig(
        policyId="POLICY_E_SIDEWAYS_EV_INCREASE",
        policies={
            'BULL': RegimePolicy('BULL', maxExposure=1.0, evThresholdMultiplier=1.0),
            'SIDEWAYS': RegimePolicy('SIDEWAYS', maxExposure=1.0, evThresholdMultiplier=1.25),
            'BEAR': RegimePolicy('BEAR', maxExposure=1.0, evThresholdMultiplier=1.0),
            'HIGH_VOLATILITY': RegimePolicy('HIGH_VOLATILITY', maxExposure=1.0, evThresholdMultiplier=1.0),
            'PANIC': RegimePolicy('PANIC', maxExposure=1.0, evThresholdMultiplier=1.0)
        }
    )

def build_panic_no_trade_policy() -> RegimePolicyConfig:
    """POLICY F: Hard NO_TRADE during PANIC regime."""
    return RegimePolicyConfig(
        policyId="POLICY_F_PANIC_NO_TRADE",
        policies={
            'BULL': RegimePolicy('BULL', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True),
            'SIDEWAYS': RegimePolicy('SIDEWAYS', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True),
            'BEAR': RegimePolicy('BEAR', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True),
            'HIGH_VOLATILITY': RegimePolicy('HIGH_VOLATILITY', maxExposure=1.0, evThresholdMultiplier=1.0, allowNewTrades=True),
            'PANIC': RegimePolicy('PANIC', maxExposure=0.0, evThresholdMultiplier=1.0, allowNewTrades=False)
        }
    )

def build_composite_risk_control_policy() -> RegimePolicyConfig:
    """POLICY G: Integrated risk scaling across macro regimes."""
    return RegimePolicyConfig(
        policyId="POLICY_G_COMPOSITE_RISK_CONTROL",
        policies={
            'BULL': RegimePolicy('BULL', maxExposure=1.00, evThresholdMultiplier=1.00, allowNewTrades=True),
            'SIDEWAYS': RegimePolicy('SIDEWAYS', maxExposure=0.75, evThresholdMultiplier=1.10, allowNewTrades=True),
            'BEAR': RegimePolicy('BEAR', maxExposure=0.50, evThresholdMultiplier=1.25, allowNewTrades=True),
            'HIGH_VOLATILITY': RegimePolicy('HIGH_VOLATILITY', maxExposure=0.50, evThresholdMultiplier=1.25, allowNewTrades=True),
            'PANIC': RegimePolicy('PANIC', maxExposure=0.00, evThresholdMultiplier=2.00, allowNewTrades=False)
        }
    )

def build_regime_holding_period_policy() -> RegimePolicyConfig:
    """POLICY H: Regime-conditioned holding period (BULL: 10d, SIDEWAYS: 5d, BEAR: 3d, HIGH_VOL: 3d, PANIC: NO_TRADE)."""
    return RegimePolicyConfig(
        policyId="POLICY_H_REGIME_HOLDING_PERIOD",
        policies={
            'BULL': RegimePolicy('BULL', maxExposure=1.00, holdingPeriod=10, allowNewTrades=True),
            'SIDEWAYS': RegimePolicy('SIDEWAYS', maxExposure=0.75, holdingPeriod=5, allowNewTrades=True),
            'BEAR': RegimePolicy('BEAR', maxExposure=0.50, holdingPeriod=3, allowNewTrades=True),
            'HIGH_VOLATILITY': RegimePolicy('HIGH_VOLATILITY', maxExposure=0.50, holdingPeriod=3, allowNewTrades=True),
            'PANIC': RegimePolicy('PANIC', maxExposure=0.00, holdingPeriod=1, allowNewTrades=False)
        }
    )
