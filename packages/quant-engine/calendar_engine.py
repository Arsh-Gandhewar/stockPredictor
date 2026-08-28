"""
Indian Exchange (NSE) Trading Calendar Engine for QuantX.
Enforces realistic settlement and trading session progression:
- Handles weekends (Saturday & Sunday closures)
- Handles fixed and floating national and exchange holidays
- Provides next-trading-session and previous-trading-session resolution
- Eliminates T+1 calendar day assumptions.
"""

from datetime import datetime, date, timedelta
from typing import Union, List, Set, Optional
import pandas as pd


class NSETradingCalendar:
    """
    Point-in-time NSE trading calendar covering 2020-2026+.
    Encodes standard statutory NSE market closures.
    """
    
    # Variable / floating holidays by year (YYYY-MM-DD)
    FLOATING_HOLIDAYS = {
        # 2020
        "2020-02-21",  # Mahashivratri
        "2020-03-10",  # Holi
        "2020-04-02",  # Ram Navami
        "2020-04-06",  # Mahavir Jayanti
        "2020-04-10",  # Good Friday
        "2020-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
        "2020-05-25",  # Id-Ul-Fitr
        "2020-10-26",  # Dussehra
        "2020-11-16",  # Diwali Balipratipada
        "2020-11-30",  # Gurunanak Jayanti
        # 2021
        "2021-03-11",  # Mahashivratri
        "2021-03-29",  # Holi
        "2021-04-02",  # Good Friday
        "2021-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
        "2021-04-21",  # Ram Navami
        "2021-05-13",  # Id-Ul-Fitr
        "2021-07-21",  # Bakri Eid
        "2021-08-19",  # Muharram
        "2021-09-10",  # Ganesh Chaturthi
        "2021-10-15",  # Dussehra
        "2021-11-04",  # Diwali Laxmi Pujan
        "2021-11-05",  # Diwali Balipratipada
        "2021-11-19",  # Gurunanak Jayanti
        # 2022
        "2022-03-01",  # Mahashivratri
        "2022-03-18",  # Holi
        "2022-04-14",  # Dr. Baba Saheb Ambedkar Jayanti / Mahavir Jayanti
        "2022-04-15",  # Good Friday
        "2022-05-03",  # Id-Ul-Fitr
        "2022-08-09",  # Muharram
        "2022-08-31",  # Ganesh Chaturthi
        "2022-10-05",  # Dussehra
        "2022-10-24",  # Diwali Laxmi Pujan
        "2022-10-26",  # Diwali Balipratipada
        "2022-11-08",  # Gurunanak Jayanti
        # 2023
        "2023-01-26",  # Republic Day
        "2023-03-07",  # Holi
        "2023-03-30",  # Ram Navami
        "2023-04-04",  # Mahavir Jayanti
        "2023-04-07",  # Good Friday
        "2023-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
        "2023-04-21",  # Id-Ul-Fitr
        "2023-05-01",  # Maharashtra Day
        "2023-06-28",  # Bakri Eid
        "2023-08-15",  # Independence Day
        "2023-09-19",  # Ganesh Chaturthi
        "2023-10-02",  # Mahatma Gandhi Jayanti
        "2023-10-24",  # Dussehra
        "2023-11-14",  # Diwali Balipratipada
        "2023-11-27",  # Gurunanak Jayanti
        "2023-12-25",  # Christmas
        # 2024
        "2024-01-22",  # Special Holiday
        "2024-01-26",  # Republic Day
        "2024-03-08",  # Mahashivratri
        "2024-03-25",  # Holi
        "2024-03-29",  # Good Friday
        "2024-04-11",  # Id-Ul-Fitr
        "2024-04-17",  # Ram Navami
        "2024-05-01",  # Maharashtra Day
        "2024-05-20",  # Parliamentary Elections
        "2024-06-17",  # Bakri Eid
        "2024-07-17",  # Muharram
        "2024-08-15",  # Independence Day
        "2024-10-02",  # Mahatma Gandhi Jayanti
        "2024-11-01",  # Diwali Laxmi Pujan
        "2024-11-15",  # Gurunanak Jayanti
        "2024-11-20",  # Maharashtra Assembly Elections
        "2024-12-25",  # Christmas
        # 2025
        "2025-01-26",  # Republic Day (Sunday)
        "2025-02-26",  # Mahashivratri
        "2025-03-14",  # Holi
        "2025-03-31",  # Id-Ul-Fitr
        "2025-04-10",  # Mahavir Jayanti
        "2025-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
        "2025-04-18",  # Good Friday
        "2025-05-01",  # Maharashtra Day
        "2025-06-07",  # Bakri Eid
        "2025-08-15",  # Independence Day
        "2025-08-27",  # Ganesh Chaturthi
        "2025-10-02",  # Mahatma Gandhi Jayanti
        "2025-10-21",  # Diwali Laxmi Pujan
        "2025-10-22",  # Diwali Balipratipada
        "2025-11-05",  # Gurunanak Jayanti
        "2025-12-25",  # Christmas
        # 2026
        "2026-01-26",  # Republic Day
        "2026-02-15",  # Mahashivratri
        "2026-03-03",  # Holi
        "2026-04-03",  # Good Friday
        "2026-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
        "2026-05-01",  # Maharashtra Day
        "2026-08-15",  # Independence Day
        "2026-10-02",  # Mahatma Gandhi Jayanti
        "2026-10-20",  # Dussehra
        "2026-11-08",  # Diwali
        "2026-11-24",  # Gurunanak Jayanti
        "2026-12-25",  # Christmas
    }

    # Annual fixed statutory holidays (MM-DD)
    FIXED_HOLIDAYS = {
        (1, 26),   # Republic Day
        (5, 1),    # Maharashtra Day
        (8, 15),   # Independence Day
        (10, 2),   # Mahatma Gandhi Jayanti
        (12, 25),  # Christmas
    }

    @classmethod
    def to_date_obj(cls, dt: Union[str, pd.Timestamp, datetime, date]) -> date:
        """Converts input date representation to a standard datetime.date object."""
        if isinstance(dt, str):
            return datetime.strptime(str(dt)[:10], "%Y-%m-%d").date()
        elif isinstance(dt, pd.Timestamp):
            return dt.date()
        elif isinstance(dt, datetime):
            return dt.date()
        elif isinstance(dt, date):
            return dt
        raise TypeError(f"Unsupported date format: {type(dt)}")

    @classmethod
    def is_trading_day(cls, dt: Union[str, pd.Timestamp, datetime, date]) -> bool:
        """
        Returns True if the specified date is an active NSE trading day.
        Returns False for weekends and statutory exchange holidays.
        """
        d = cls.to_date_obj(dt)
        # Check weekend: Saturday (5) and Sunday (6)
        if d.weekday() >= 5:
            return False
        
        # Check annual fixed holidays
        if (d.month, d.day) in cls.FIXED_HOLIDAYS:
            return False
            
        # Check floating holidays
        d_str = d.strftime("%Y-%m-%d")
        if d_str in cls.FLOATING_HOLIDAYS:
            return False
            
        return True

    @classmethod
    def next_trading_session(cls, dt: Union[str, pd.Timestamp, datetime, date]) -> pd.Timestamp:
        """
        Returns the next executable trading session strictly after dt.
        Handles Friday -> Monday and pre-holiday session skips.
        """
        curr = cls.to_date_obj(dt) + timedelta(days=1)
        while not cls.is_trading_day(curr):
            curr += timedelta(days=1)
        return pd.Timestamp(curr)

    @classmethod
    def previous_trading_session(cls, dt: Union[str, pd.Timestamp, datetime, date]) -> pd.Timestamp:
        """Returns the previous executable trading session strictly prior to dt."""
        curr = cls.to_date_obj(dt) - timedelta(days=1)
        while not cls.is_trading_day(curr):
            curr -= timedelta(days=1)
        return pd.Timestamp(curr)

    @classmethod
    def get_trading_days(
        cls,
        start_date: Union[str, pd.Timestamp, datetime, date],
        end_date: Union[str, pd.Timestamp, datetime, date]
    ) -> List[pd.Timestamp]:
        """Returns a list of all active trading sessions between start_date and end_date inclusive."""
        start = cls.to_date_obj(start_date)
        end = cls.to_date_obj(end_date)
        if start > end:
            return []
            
        trading_days = []
        curr = start
        while curr <= end:
            if cls.is_trading_day(curr):
                trading_days.append(pd.Timestamp(curr))
            curr += timedelta(days=1)
        return trading_days

    @classmethod
    def trading_days_between(
        cls,
        start_date: Union[str, pd.Timestamp, datetime, date],
        end_date: Union[str, pd.Timestamp, datetime, date]
    ) -> int:
        """Returns the count of active trading sessions between start and end inclusive."""
        return len(cls.get_trading_days(start_date, end_date))
