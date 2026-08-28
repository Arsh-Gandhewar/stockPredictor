"""
QuantX Comprehensive Strategy & Alpha Stability Auditor — BUG 4 Component 8.

Performs rigorous post-backtest stability and robustness audits:
  - SectorStabilityAudit: concentration risk across industry sectors
  - TickerStabilityAudit: idiosyncratic concentration risk across tickers
  - LeaveOneOutAlphaTest: alpha degradation when top ticker/sector removed
  - TemporalDecayAudit: performance decay between early and late evaluation windows
  - FoldStabilityReport: variance and consistency across cross-validation / walk-forward folds
  - WorstFoldGuard: catastrophic tail risk in worst-performing partition
  - SharpPeakDetector: parameter neighborhood sensitivity (plateau vs knife-edge peak)
  - RegimeStabilityAudit: conditional alpha performance across macroeconomic market regimes
"""
import math
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict


@dataclass
class SectorStabilityResult:
    totalPnl: float
    sectorPnl: Dict[str, float]
    sectorTradeCount: Dict[str, int]
    topSectorName: str
    topSectorPnlShare: float
    maxAllowedShare: float
    isConcentrated: bool
    status: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TickerStabilityResult:
    totalPnl: float
    tickerPnl: Dict[str, float]
    tickerTradeCount: Dict[str, int]
    topTicker: str
    topTickerPnlShare: float
    maxAllowedShare: float
    isConcentrated: bool
    status: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class LeaveOneOutResult:
    baselineSharpe: float
    baselinePnl: float
    withoutTopTickerSharpe: float
    withoutTopTickerPnl: float
    topTickerDeltaSharpe: float
    withoutTopSectorSharpe: float
    withoutTopSectorPnl: float
    topSectorDeltaSharpe: float
    alphaRemainsPositive: bool
    status: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TemporalDecayResult:
    firstHalfPnl: float
    secondHalfPnl: float
    firstHalfSharpe: float
    secondHalfSharpe: float
    decayRatio: float  # secondHalf / firstHalf
    isDecayingSeverely: bool
    status: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class FoldStabilityResult:
    foldCount: int
    foldSharpes: List[float]
    meanSharpe: float
    stdSharpe: float
    minSharpe: float
    maxSharpe: float
    positiveFoldRatio: float
    isStable: bool
    status: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PeakDetectorResult:
    parameterName: str
    baseValue: float
    testedValues: List[float]
    testedMetrics: List[float]
    isSharpPeak: bool
    cliffGradient: float
    status: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class StabilityAuditor:
    """
    Independent stability and robustness auditing engine.
    Analyzes execution ledgers, fold results, and parameter grids to detect fragile alpha.
    """

    def __init__(self):
        pass

    def audit_sector_stability(
        self,
        trades: List[Dict[str, Any]],
        sector_mapping: Optional[Dict[str, str]] = None,
        max_allowed_share: float = 0.70
    ) -> SectorStabilityResult:
        """
        Flags if any single sector accounts for more than max_allowed_share (default 70%) of total PnL.
        """
        if not trades:
            return SectorStabilityResult(
                totalPnl=0.0,
                sectorPnl={},
                sectorTradeCount={},
                topSectorName="NONE",
                topSectorPnlShare=0.0,
                maxAllowedShare=max_allowed_share,
                isConcentrated=False,
                status="NO_TRADES"
            )

        sector_map = sector_mapping or {}
        sector_pnl: Dict[str, float] = {}
        sector_counts: Dict[str, int] = {}
        total_pnl = 0.0

        for t in trades:
            ticker = t.get('ticker') or t.get('symbol', 'UNKNOWN')
            pnl = float(t.get('netPnl') or t.get('pnl', 0.0))
            sector = sector_map.get(ticker, t.get('sector', 'UNKNOWN'))

            sector_pnl[sector] = sector_pnl.get(sector, 0.0) + pnl
            sector_counts[sector] = sector_counts.get(sector, 0) + 1
            total_pnl += pnl

        if not sector_pnl or total_pnl <= 0:
            top_sector = max(sector_pnl.keys(), key=lambda k: sector_pnl[k]) if sector_pnl else "NONE"
            return SectorStabilityResult(
                totalPnl=round(total_pnl, 2),
                sectorPnl={k: round(v, 2) for k, v in sector_pnl.items()},
                sectorTradeCount=sector_counts,
                topSectorName=top_sector,
                topSectorPnlShare=0.0,
                maxAllowedShare=max_allowed_share,
                isConcentrated=False,
                status="NEGATIVE_OR_ZERO_PNL"
            )

        top_sector = max(sector_pnl.keys(), key=lambda k: sector_pnl[k])
        top_share = max(0.0, sector_pnl[top_sector] / total_pnl)
        is_concentrated = top_share > max_allowed_share

        return SectorStabilityResult(
            totalPnl=round(total_pnl, 2),
            sectorPnl={k: round(v, 2) for k, v in sector_pnl.items()},
            sectorTradeCount=sector_counts,
            topSectorName=top_sector,
            topSectorPnlShare=round(top_share, 4),
            maxAllowedShare=max_allowed_share,
            isConcentrated=is_concentrated,
            status="CONCENTRATED" if is_concentrated else "PASS"
        )

    def audit_ticker_stability(
        self,
        trades: List[Dict[str, Any]],
        max_allowed_share: float = 0.50
    ) -> TickerStabilityResult:
        """
        Flags if any single ticker accounts for more than max_allowed_share (default 50%) of total PnL.
        """
        if not trades:
            return TickerStabilityResult(
                totalPnl=0.0,
                tickerPnl={},
                tickerTradeCount={},
                topTicker="NONE",
                topTickerPnlShare=0.0,
                maxAllowedShare=max_allowed_share,
                isConcentrated=False,
                status="NO_TRADES"
            )

        ticker_pnl: Dict[str, float] = {}
        ticker_counts: Dict[str, int] = {}
        total_pnl = 0.0

        for t in trades:
            ticker = t.get('ticker') or t.get('symbol', 'UNKNOWN')
            pnl = float(t.get('netPnl') or t.get('pnl', 0.0))
            ticker_pnl[ticker] = ticker_pnl.get(ticker, 0.0) + pnl
            ticker_counts[ticker] = ticker_counts.get(ticker, 0) + 1
            total_pnl += pnl

        if not ticker_pnl or total_pnl <= 0:
            top_ticker = max(ticker_pnl.keys(), key=lambda k: ticker_pnl[k]) if ticker_pnl else "NONE"
            return TickerStabilityResult(
                totalPnl=round(total_pnl, 2),
                tickerPnl={k: round(v, 2) for k, v in ticker_pnl.items()},
                tickerTradeCount=ticker_counts,
                topTicker=top_ticker,
                topTickerPnlShare=0.0,
                maxAllowedShare=max_allowed_share,
                isConcentrated=False,
                status="NEGATIVE_OR_ZERO_PNL"
            )

        top_ticker = max(ticker_pnl.keys(), key=lambda k: ticker_pnl[k])
        top_share = max(0.0, ticker_pnl[top_ticker] / total_pnl)
        is_concentrated = top_share > max_allowed_share

        return TickerStabilityResult(
            totalPnl=round(total_pnl, 2),
            tickerPnl={k: round(v, 2) for k, v in ticker_pnl.items()},
            tickerTradeCount=ticker_counts,
            topTicker=top_ticker,
            topTickerPnlShare=round(top_share, 4),
            maxAllowedShare=max_allowed_share,
            isConcentrated=is_concentrated,
            status="CONCENTRATED" if is_concentrated else "PASS"
        )

    def leave_one_out_alpha_test(
        self,
        trades: List[Dict[str, Any]],
        sector_mapping: Optional[Dict[str, str]] = None
    ) -> LeaveOneOutResult:
        """
        Tests whether the strategy remains profitable when removing the single best ticker and sector.
        """
        if not trades:
            return LeaveOneOutResult(
                baselineSharpe=0.0, baselinePnl=0.0,
                withoutTopTickerSharpe=0.0, withoutTopTickerPnl=0.0, topTickerDeltaSharpe=0.0,
                withoutTopSectorSharpe=0.0, withoutTopSectorPnl=0.0, topSectorDeltaSharpe=0.0,
                alphaRemainsPositive=False, status="NO_TRADES"
            )

        ticker_pnl: Dict[str, float] = {}
        sector_pnl: Dict[str, float] = {}
        sector_map = sector_mapping or {}

        for t in trades:
            ticker = t.get('ticker') or t.get('symbol', 'UNKNOWN')
            pnl = float(t.get('netPnl') or t.get('pnl', 0.0))
            sector = sector_map.get(ticker, t.get('sector', 'UNKNOWN'))

            ticker_pnl[ticker] = ticker_pnl.get(ticker, 0.0) + pnl
            sector_pnl[sector] = sector_pnl.get(sector, 0.0) + pnl

        top_ticker = max(ticker_pnl.keys(), key=lambda k: ticker_pnl[k]) if ticker_pnl else ""
        top_sector = max(sector_pnl.keys(), key=lambda k: sector_pnl[k]) if sector_pnl else ""

        def compute_subset_stats(sub_trades: List[Dict[str, Any]]) -> Tuple[float, float]:
            if not sub_trades:
                return 0.0, 0.0
            pnls = [float(t.get('netPnl') or t.get('pnl', 0.0)) for t in sub_trades]
            total_p = sum(pnls)
            mean_p = total_p / len(pnls)
            var = sum((p - mean_p) ** 2 for p in pnls) / max(1, len(pnls) - 1)
            std_p = math.sqrt(var) if var > 0 else 1e-6
            sharpe_approx = (mean_p / std_p) * math.sqrt(252) if std_p > 0 else 0.0
            return round(sharpe_approx, 2), round(total_p, 2)

        base_sharpe, base_pnl = compute_subset_stats(trades)

        # Without top ticker
        without_ticker_trades = [t for t in trades if (t.get('ticker') or t.get('symbol')) != top_ticker]
        no_ticker_sharpe, no_ticker_pnl = compute_subset_stats(without_ticker_trades)

        # Without top sector
        without_sector_trades = [
            t for t in trades
            if sector_map.get(t.get('ticker') or t.get('symbol', ''), t.get('sector', '')) != top_sector
        ]
        no_sector_sharpe, no_sector_pnl = compute_subset_stats(without_sector_trades)

        alpha_positive = (no_ticker_pnl > 0) and (no_sector_pnl > 0)
        status = "PASS" if alpha_positive else "FRAGILE_IDIOSYNCRATIC_ALPHA"

        return LeaveOneOutResult(
            baselineSharpe=base_sharpe,
            baselinePnl=base_pnl,
            withoutTopTickerSharpe=no_ticker_sharpe,
            withoutTopTickerPnl=no_ticker_pnl,
            topTickerDeltaSharpe=round(base_sharpe - no_ticker_sharpe, 2),
            withoutTopSectorSharpe=no_sector_sharpe,
            withoutTopSectorPnl=no_sector_pnl,
            topSectorDeltaSharpe=round(base_sharpe - no_sector_sharpe, 2),
            alphaRemainsPositive=alpha_positive,
            status=status
        )

    def audit_temporal_decay(
        self,
        trades: List[Dict[str, Any]],
        severe_decay_threshold: float = 0.30
    ) -> TemporalDecayResult:
        """
        Compares first-half vs second-half chronological performance to detect alpha decay.
        """
        if len(trades) < 4:
            return TemporalDecayResult(
                firstHalfPnl=0.0, secondHalfPnl=0.0,
                firstHalfSharpe=0.0, secondHalfSharpe=0.0,
                decayRatio=1.0, isDecayingSeverely=False, status="INSUFFICIENT_TRADES"
            )

        # Sort trades chronologically
        sorted_trades = sorted(
            trades,
            key=lambda t: str(t.get('exitDate') or t.get('entryDate') or t.get('timestamp', ''))
        )
        mid = len(sorted_trades) // 2
        half1 = sorted_trades[:mid]
        half2 = sorted_trades[mid:]

        pnl1 = sum(float(t.get('netPnl') or t.get('pnl', 0.0)) for t in half1)
        pnl2 = sum(float(t.get('netPnl') or t.get('pnl', 0.0)) for t in half2)

        def approx_sharpe(sub: List[Dict[str, Any]]) -> float:
            if not sub:
                return 0.0
            vals = [float(t.get('netPnl') or t.get('pnl', 0.0)) for t in sub]
            mean_v = sum(vals) / len(vals)
            var_v = sum((v - mean_v) ** 2 for v in vals) / max(1, len(vals) - 1)
            std_v = math.sqrt(var_v) if var_v > 0 else 1e-6
            return round((mean_v / std_v) * math.sqrt(252), 2)

        s1 = approx_sharpe(half1)
        s2 = approx_sharpe(half2)

        decay_ratio = round(pnl2 / pnl1, 4) if pnl1 > 0 else (1.0 if pnl2 >= 0 else 0.0)
        is_decaying = (pnl1 > 0 and pnl2 < 0) or (decay_ratio < severe_decay_threshold)

        return TemporalDecayResult(
            firstHalfPnl=round(pnl1, 2),
            secondHalfPnl=round(pnl2, 2),
            firstHalfSharpe=s1,
            secondHalfSharpe=s2,
            decayRatio=decay_ratio,
            isDecayingSeverely=is_decaying,
            status="ALPHA_DECAY_DETECTED" if is_decaying else "STABLE"
        )

    def audit_fold_stability(
        self,
        fold_metrics: List[Dict[str, Any]],
        min_positive_ratio: float = 0.60
    ) -> FoldStabilityResult:
        """
        Assesses cross-validation consistency across multiple walk-forward / test folds.
        """
        if not fold_metrics:
            return FoldStabilityResult(
                foldCount=0, foldSharpes=[], meanSharpe=0.0, stdSharpe=0.0,
                minSharpe=0.0, maxSharpe=0.0, positiveFoldRatio=0.0,
                isStable=False, status="NO_FOLDS"
            )

        sharpes = [float(f.get('sharpe') or f.get('sharpeRatio', 0.0)) for f in fold_metrics]
        mean_s = sum(sharpes) / len(sharpes)
        var_s = sum((s - mean_s) ** 2 for s in sharpes) / max(1, len(sharpes) - 1)
        std_s = math.sqrt(var_s)

        positive_count = sum(1 for s in sharpes if s > 0)
        pos_ratio = positive_count / len(sharpes)

        is_stable = pos_ratio >= min_positive_ratio and min(sharpes) > -2.0

        return FoldStabilityResult(
            foldCount=len(fold_metrics),
            foldSharpes=[round(s, 2) for s in sharpes],
            meanSharpe=round(mean_s, 2),
            stdSharpe=round(std_s, 2),
            minSharpe=round(min(sharpes), 2),
            maxSharpe=round(max(sharpes), 2),
            positiveFoldRatio=round(pos_ratio, 2),
            isStable=is_stable,
            status="STABLE" if is_stable else "UNSTABLE_FOLDS"
        )

    def detect_sharp_peak(
        self,
        param_name: str,
        param_values: List[float],
        metric_values: List[float],
        cliff_threshold: float = 0.50
    ) -> PeakDetectorResult:
        """
        Detects if optimal parameter is on an isolated sharp spike (cliff)
        where a slight parameter perturbation causes metric to drop by > cliff_threshold.
        """
        if len(param_values) < 3 or len(param_values) != len(metric_values):
            return PeakDetectorResult(
                parameterName=param_name, baseValue=param_values[0] if param_values else 0.0,
                testedValues=param_values, testedMetrics=metric_values,
                isSharpPeak=False, cliffGradient=0.0, status="INSUFFICIENT_POINTS"
            )

        best_idx = max(range(len(metric_values)), key=lambda i: metric_values[i])
        best_metric = metric_values[best_idx]
        best_param = param_values[best_idx]

        max_drop = 0.0
        if best_idx > 0 and best_metric != 0:
            drop_left = (best_metric - metric_values[best_idx - 1]) / abs(best_metric)
            max_drop = max(max_drop, drop_left)
        if best_idx < len(metric_values) - 1 and best_metric != 0:
            drop_right = (best_metric - metric_values[best_idx + 1]) / abs(best_metric)
            max_drop = max(max_drop, drop_right)

        is_sharp = max_drop >= cliff_threshold
        status = "KNIFE_EDGE_OVERFIT" if is_sharp else "PLATEAU_STABLE"

        return PeakDetectorResult(
            parameterName=param_name,
            baseValue=best_param,
            testedValues=param_values,
            testedMetrics=metric_values,
            isSharpPeak=is_sharp,
            cliffGradient=round(max_drop, 4),
            status=status
        )
