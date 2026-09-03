"""
QuantX Historical Universe Engine.
Enforces point-in-time universe construction, prevents survivorship bias,
look-ahead universe selection, and retroactive current-universe contamination.
"""
import os
import json
import hashlib
from typing import Dict, List, Any, Optional, Tuple, Set
from dataclasses import dataclass, asdict
import pandas as pd
import numpy as np

class SurvivorshipBiasError(Exception):
    """Raised when contemporary universe membership or future survivorship is applied retrospectively."""
    pass

class UniverseLookaheadError(Exception):
    """Raised when future volume, prices, market cap, or delisting events leak into historical date T."""
    pass

class HistoricalDataUnavailableError(Exception):
    """Raised when historical data is missing and cannot be verified point-in-time."""
    pass


@dataclass
class HistoricalUniverseRecord:
    ticker: str
    effectiveDate: str
    eligible: bool
    eligibilityReason: str
    listingStatus: str
    delistingStatus: Optional[str]
    liquidityStatus: str
    universeMembership: bool
    universeVersion: str
    universeHash: str
    trailingADV: Optional[float] = None
    sector: str = "UNKNOWN"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Authoritative Security Metadata Master (Point-in-Time Foundation spanning 1996-2026)
HISTORICAL_SECURITY_MASTER: Dict[str, Dict[str, Any]] = {
    # Core Bluechips
    "RELIANCE.NS": {"name": "Reliance Industries", "sector": "Energy", "listingDate": "1977-11-29", "delistingDate": None, "aliases": []},
    "TCS.NS": {"name": "Tata Consultancy Services", "sector": "IT", "listingDate": "2004-08-25", "delistingDate": None, "aliases": []},
    "HDFCBANK.NS": {"name": "HDFC Bank", "sector": "Financials", "listingDate": "1995-05-19", "delistingDate": None, "aliases": []},
    "ICICIBANK.NS": {"name": "ICICI Bank", "sector": "Financials", "listingDate": "1998-09-22", "delistingDate": None, "aliases": []},
    "INFY.NS": {"name": "Infosys", "sector": "IT", "listingDate": "1993-06-14", "delistingDate": None, "aliases": []},
    "ITC.NS": {"name": "ITC Limited", "sector": "Consumer Goods", "listingDate": "1970-01-01", "delistingDate": None, "aliases": []},
    "BHARTIARTL.NS": {"name": "Bharti Airtel", "sector": "Telecom", "listingDate": "2002-02-18", "delistingDate": None, "aliases": []},
    "SBIN.NS": {"name": "State Bank of India", "sector": "Financials", "listingDate": "1995-03-01", "delistingDate": None, "aliases": []},
    "LT.NS": {"name": "Larsen & Toubro", "sector": "Industrials", "listingDate": "1950-01-01", "delistingDate": None, "aliases": []},
    "TATAMOTORS.NS": {"name": "Tata Motors", "sector": "Automobile", "listingDate": "1955-01-01", "delistingDate": "2024-01-01", "aliases": []},
    "SUNPHARMA.NS": {"name": "Sun Pharma", "sector": "Healthcare", "listingDate": "1994-11-08", "delistingDate": None, "aliases": []},
    "TITAN.NS": {"name": "Titan Company", "sector": "Consumer Goods", "listingDate": "1987-03-24", "delistingDate": None, "aliases": []},
    "BAJFINANCE.NS": {"name": "Bajaj Finance", "sector": "Financials", "listingDate": "1998-07-01", "delistingDate": None, "aliases": []},
    "MARUTI.NS": {"name": "Maruti Suzuki", "sector": "Automobile", "listingDate": "2003-07-09", "delistingDate": None, "aliases": []},
    "KOTAKBANK.NS": {"name": "Kotak Mahindra Bank", "sector": "Financials", "listingDate": "1992-04-08", "delistingDate": None, "aliases": []},
    "AXISBANK.NS": {"name": "Axis Bank", "sector": "Financials", "listingDate": "1998-11-16", "delistingDate": None, "aliases": []},
    "NTPC.NS": {"name": "NTPC Limited", "sector": "Utilities", "listingDate": "2004-11-05", "delistingDate": None, "aliases": []},
    "POWERGRID.NS": {"name": "Power Grid Corp", "sector": "Utilities", "listingDate": "2007-10-05", "delistingDate": None, "aliases": []},
    "TATASTEEL.NS": {"name": "Tata Steel", "sector": "Materials", "listingDate": "1950-01-01", "delistingDate": None, "aliases": []},
    "ADANIENT.NS": {"name": "Adani Enterprises", "sector": "Energy", "listingDate": "1994-11-04", "delistingDate": None, "aliases": []},
    "COALINDIA.NS": {"name": "Coal India", "sector": "Energy", "listingDate": "2010-11-04", "delistingDate": None, "aliases": []},
    "BHEL.NS": {"name": "Bharat Heavy Electricals", "sector": "Industrials", "listingDate": "1991-01-01", "delistingDate": None, "aliases": []},
    "DIXON.NS": {"name": "Dixon Technologies", "sector": "Industrials", "listingDate": "2017-09-18", "delistingDate": None, "aliases": []},
    "COCHINSHIP.NS": {"name": "Cochin Shipyard", "sector": "Industrials", "listingDate": "2017-08-11", "delistingDate": None, "aliases": []},
    "POLICYBZR.NS": {"name": "PB Fintech", "sector": "Financials", "listingDate": "2021-11-15", "delistingDate": None, "aliases": []},
    # Liquid & Historical Constituents (Survivorship Bias & Era Coverage Foundations)
    "M&M.NS": {"name": "Mahindra & Mahindra", "sector": "Automobile", "listingDate": "1950-01-01", "delistingDate": None, "aliases": []},
    "WIPRO.NS": {"name": "Wipro", "sector": "IT", "listingDate": "1995-01-01", "delistingDate": None, "aliases": []},
    "HCLTECH.NS": {"name": "HCL Technologies", "sector": "IT", "listingDate": "1999-12-08", "delistingDate": None, "aliases": []},
    "ONGC.NS": {"name": "Oil & Natural Gas Corp", "sector": "Energy", "listingDate": "1994-01-01", "delistingDate": None, "aliases": []},
    "JSWSTEEL.NS": {"name": "JSW Steel", "sector": "Materials", "listingDate": "2003-05-08", "delistingDate": None, "aliases": []},
    "ADANIPORTS.NS": {"name": "Adani Ports", "sector": "Industrials", "listingDate": "2007-11-27", "delistingDate": None, "aliases": []},
    "BAJAJFINSV.NS": {"name": "Bajaj Finserv", "sector": "Financials", "listingDate": "2008-05-26", "delistingDate": None, "aliases": []},
    "VEDL.NS": {"name": "Vedanta Limited", "sector": "Materials", "listingDate": "1996-01-01", "delistingDate": None, "aliases": []},
    "SAIL.NS": {"name": "Steel Authority of India", "sector": "Materials", "listingDate": "1996-01-01", "delistingDate": None, "aliases": []},
    "PNB.NS": {"name": "Punjab National Bank", "sector": "Financials", "listingDate": "2002-07-01", "delistingDate": None, "aliases": []},
    "YESBANK.NS": {"name": "Yes Bank", "sector": "Financials", "listingDate": "2005-07-12", "delistingDate": "2020-03-27", "aliases": []},
    "ZEEL.NS": {"name": "Zee Entertainment", "sector": "Communication Services", "listingDate": "2002-07-01", "delistingDate": None, "aliases": []},
    "IDEA.NS": {"name": "Vodafone Idea", "sector": "Telecom", "listingDate": "2007-03-09", "delistingDate": None, "aliases": []},
    "RCOM.NS": {"name": "Reliance Communications", "sector": "Telecom", "listingDate": "2006-03-06", "delistingDate": "2019-06-28", "aliases": []},
    "SUZLON.NS": {"name": "Suzlon Energy", "sector": "Industrials", "listingDate": "2005-10-19", "delistingDate": None, "aliases": []},
    "GAIL.NS": {"name": "GAIL India", "sector": "Energy", "listingDate": "1997-04-02", "delistingDate": None, "aliases": []},
    "BPCL.NS": {"name": "Bharat Petroleum", "sector": "Energy", "listingDate": "1996-01-02", "delistingDate": None, "aliases": []},
    "IOC.NS": {"name": "Indian Oil Corp", "sector": "Energy", "listingDate": "1996-04-15", "delistingDate": None, "aliases": []},
    "CIPLA.NS": {"name": "Cipla", "sector": "Healthcare", "listingDate": "1996-01-01", "delistingDate": None, "aliases": []},
    "DRREDDY.NS": {"name": "Dr. Reddy's Laboratories", "sector": "Healthcare", "listingDate": "1996-01-01", "delistingDate": None, "aliases": []},
    "GRASIM.NS": {"name": "Grasim Industries", "sector": "Materials", "listingDate": "2002-07-01", "delistingDate": None, "aliases": []},
    "HEROMOTOCO.NS": {"name": "Hero MotoCorp", "sector": "Automobile", "listingDate": "2002-07-01", "delistingDate": None, "aliases": []},
    "HINDALCO.NS": {"name": "Hindalco Industries", "sector": "Materials", "listingDate": "1996-01-01", "delistingDate": None, "aliases": []},
    "DIVISLAB.NS": {"name": "Divi's Laboratories", "sector": "Healthcare", "listingDate": "2003-03-12", "delistingDate": None, "aliases": []},
    "UPL.NS": {"name": "UPL Limited", "sector": "Materials", "listingDate": "2002-07-01", "delistingDate": None, "aliases": []},
    "TECHM.NS": {"name": "Tech Mahindra", "sector": "IT", "listingDate": "2006-08-28", "delistingDate": None, "aliases": []},
    "EICHERMOT.NS": {"name": "Eicher Motors", "sector": "Automobile", "listingDate": "1996-01-01", "delistingDate": None, "aliases": []},
    "SHRIRAMFIN.NS": {"name": "Shriram Finance", "sector": "Financials", "listingDate": "2002-07-01", "delistingDate": None, "aliases": []},
    "TRENT.NS": {"name": "Trent Limited", "sector": "Consumer Goods", "listingDate": "2002-07-01", "delistingDate": None, "aliases": []},
    "BEL.NS": {"name": "Bharat Electronics", "sector": "Industrials", "listingDate": "2002-07-01", "delistingDate": None, "aliases": []},
    "HAL.NS": {"name": "Hindustan Aeronautics", "sector": "Industrials", "listingDate": "2018-04-02", "delistingDate": None, "aliases": []},
}

HISTORICAL_DATA_WINDOW_START = "2007-09-17"
FEATURE_WARMUP_COMPLETE_DATE = "2007-12-10"
FULL_VIX_START_DATE = "2008-03-03"
HISTORICAL_DATA_WINDOW_END = "2026-09-03"

SURVIVORSHIP_BIAS_STATUS = "NOT_FULLY_RESOLVED"
FULL_HISTORICAL_TOP500_CERTIFICATION = False
UNIVERSE_VERSION = "v8.0.0-pit-universe"


class HistoricalUniverseEngine:
    """
    Centralized, authoritative point-in-time universe construction engine.
    Ensures that every security evaluated at date T was genuinely listed, tradable,
    and liquid at or before T.
    """
    def __init__(
        self,
        security_master: Optional[Dict[str, Dict[str, Any]]] = None,
        historical_candles_by_ticker: Optional[Dict[str, pd.DataFrame]] = None,
        universe_version: str = UNIVERSE_VERSION,
        min_adv_threshold: float = 1_000_000.0,
        adv_lookback_days: int = 20
    ):
        self.security_master = security_master or HISTORICAL_SECURITY_MASTER
        self.candles = historical_candles_by_ticker or {}
        self.universe_version = universe_version
        self.min_adv_threshold = min_adv_threshold
        self.adv_lookback_days = adv_lookback_days
        self._snapshot_cache: Dict[str, List[HistoricalUniverseRecord]] = {}

    def compute_universe_hash(self, date_str: str, eligible_records: List[HistoricalUniverseRecord]) -> str:
        """Computes deterministic SHA-256 fingerprint of universe snapshot at date_str."""
        sorted_tickers = sorted([r.ticker for r in eligible_records if r.eligible])
        payload = {
            "date": date_str,
            "universeVersion": self.universe_version,
            "minAdvThreshold": self.min_adv_threshold,
            "advLookbackDays": self.adv_lookback_days,
            "eligibleTickers": sorted_tickers,
            "eligibleCount": len(sorted_tickers)
        }
        canonical_json = json.dumps(payload, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(canonical_json.encode('utf-8')).hexdigest()

    def get_eligible_securities(
        self,
        timestamp: str,
        candles_dict: Optional[Dict[str, pd.DataFrame]] = None,
        enforce_current_survivors_only: bool = False
    ) -> List[HistoricalUniverseRecord]:
        """
        Determines the exact point-in-time universe available on timestamp T.
        Enforces:
        1. listingDate <= T
        2. delistingDate > T (if delisted)
        3. Point-in-time 20-day rolling ADV >= min_adv_threshold using only data <= T
        4. Distinction between NOT_LISTED, DELISTED, ILLIQUID, DATA_UNAVAILABLE, and ELIGIBLE.
        """
        if enforce_current_survivors_only:
            raise SurvivorshipBiasError(
                "CRITICAL GOVERNANCE VIOLATION: Current-universe retroactive enforcement is strictly forbidden!"
            )

        date_str = str(timestamp)[:10]
        candles_source = candles_dict if candles_dict is not None else self.candles

        records: List[HistoricalUniverseRecord] = []

        # Deterministic sorting of tickers to guarantee zero file/dictionary order dependence
        sorted_tickers = sorted(self.security_master.keys())

        for ticker in sorted_tickers:
            meta = self.security_master[ticker]
            listing_date = meta.get("listingDate")
            delisting_date = meta.get("delistingDate")
            sector = meta.get("sector", "UNKNOWN")

            # 1. Listing Date Gate
            if listing_date and date_str < str(listing_date)[:10]:
                rec = HistoricalUniverseRecord(
                    ticker=ticker,
                    effectiveDate=date_str,
                    eligible=False,
                    eligibilityReason="NOT_LISTED",
                    listingStatus="PRE_LISTING",
                    delistingStatus=None,
                    liquidityStatus="NOT_APPLICABLE",
                    universeMembership=False,
                    universeVersion=self.universe_version,
                    universeHash="",
                    sector=sector
                )
                records.append(rec)
                continue

            # 2. Delisting Date Gate
            if delisting_date and date_str >= str(delisting_date)[:10]:
                rec = HistoricalUniverseRecord(
                    ticker=ticker,
                    effectiveDate=date_str,
                    eligible=False,
                    eligibilityReason="DELISTED",
                    listingStatus="DELISTED",
                    delistingStatus=f"DELISTED_ON_{delisting_date}",
                    liquidityStatus="NOT_APPLICABLE",
                    universeMembership=False,
                    universeVersion=self.universe_version,
                    universeHash="",
                    sector=sector
                )
                records.append(rec)
                continue

            # 3. Data Availability Gate
            df = candles_source.get(ticker)
            if df is None or len(df) == 0:
                rec = HistoricalUniverseRecord(
                    ticker=ticker,
                    effectiveDate=date_str,
                    eligible=False,
                    eligibilityReason="DATA_UNAVAILABLE",
                    listingStatus="LISTED",
                    delistingStatus=None,
                    liquidityStatus="UNKNOWN",
                    universeMembership=False,
                    universeVersion=self.universe_version,
                    universeHash="",
                    sector=sector
                )
                records.append(rec)
                continue

            # 4. Lookahead Penetration Guard
            if any(str(col).startswith("future_") for col in df.columns):
                raise UniverseLookaheadError(f"CRITICAL LOOKAHEAD: Future data column detected in {ticker} candles!")

            # Truncate strictly to data <= date_str
            past_df = df.loc[df.index <= date_str]
            if len(past_df) < self.adv_lookback_days:
                rec = HistoricalUniverseRecord(
                    ticker=ticker,
                    effectiveDate=date_str,
                    eligible=False,
                    eligibilityReason="MISSING_HISTORY",
                    listingStatus="LISTED",
                    delistingStatus=None,
                    liquidityStatus="INSUFFICIENT_HISTORY",
                    universeMembership=False,
                    universeVersion=self.universe_version,
                    universeHash="",
                    sector=sector
                )
                records.append(rec)
                continue

            # 5. Point-in-Time Rolling ADV Calculation (strictly prior/current T)
            recent_slice = past_df.tail(self.adv_lookback_days)
            if 'Close' in recent_slice.columns and 'Volume' in recent_slice.columns:
                adv = float((recent_slice['Close'] * recent_slice['Volume']).mean())
            else:
                adv = 0.0

            if adv < self.min_adv_threshold:
                rec = HistoricalUniverseRecord(
                    ticker=ticker,
                    effectiveDate=date_str,
                    eligible=False,
                    eligibilityReason="ILLIQUID",
                    listingStatus="LISTED",
                    delistingStatus=None,
                    liquidityStatus="ILLIQUID",
                    universeMembership=False,
                    universeVersion=self.universe_version,
                    universeHash="",
                    trailingADV=adv,
                    sector=sector
                )
                records.append(rec)
                continue

            # 6. Passed all gates -> ELIGIBLE
            rec = HistoricalUniverseRecord(
                ticker=ticker,
                effectiveDate=date_str,
                eligible=True,
                eligibilityReason="ELIGIBLE",
                listingStatus="LISTED",
                delistingStatus=None,
                liquidityStatus="LIQUID",
                universeMembership=True,
                universeVersion=self.universe_version,
                universeHash="",
                trailingADV=adv,
                sector=sector
            )
            records.append(rec)

        # Compute snapshot hash and bind to all records
        snap_hash = self.compute_universe_hash(date_str, records)
        for r in records:
            r.universeHash = snap_hash

        return records

    def get_eligible_tickers(self, timestamp: str, candles_dict: Optional[Dict[str, pd.DataFrame]] = None) -> List[str]:
        """Returns sorted list of eligible tickers on date timestamp."""
        recs = self.get_eligible_securities(timestamp, candles_dict=candles_dict)
        return sorted([r.ticker for r in recs if r.eligible])
