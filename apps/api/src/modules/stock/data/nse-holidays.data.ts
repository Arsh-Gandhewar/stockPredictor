/**
 * National Stock Exchange (NSE) Official Trading Holiday Calendar
 * Includes official scheduled trading holidays for 2024, 2025, and 2026.
 */

export interface HolidayEntry {
  date: string; // YYYY-MM-DD
  name: string;
  description?: string;
  hasMuhuratTrading?: boolean;
}

export const NSE_TRADING_HOLIDAYS: HolidayEntry[] = [
  // 2024
  { date: '2024-01-22', name: 'Special Holiday (Ayodhya Ram Mandir)' },
  { date: '2024-01-26', name: 'Republic Day' },
  { date: '2024-03-08', name: 'Mahashivratri' },
  { date: '2024-03-25', name: 'Holi' },
  { date: '2024-03-29', name: 'Good Friday' },
  { date: '2024-04-11', name: 'Id-Ul-Fitr' },
  { date: '2024-04-17', name: 'Ram Navami' },
  { date: '2024-05-01', name: 'Maharashtra Day' },
  { date: '2024-05-20', name: 'General Elections (Mumbai)' },
  { date: '2024-06-17', name: 'Bakri Id' },
  { date: '2024-07-17', name: 'Muharram' },
  { date: '2024-08-15', name: 'Independence Day' },
  { date: '2024-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2024-11-01', name: 'Diwali Laxmi Pujan', hasMuhuratTrading: true },
  { date: '2024-11-15', name: 'Gurunanak Jayanti' },
  { date: '2024-11-20', name: 'Maharashtra Assembly Elections' },
  { date: '2024-12-25', name: 'Christmas' },

  // 2025
  { date: '2025-01-26', name: 'Republic Day' },
  { date: '2025-02-26', name: 'Mahashivratri' },
  { date: '2025-03-14', name: 'Holi' },
  { date: '2025-03-31', name: 'Id-Ul-Fitr' },
  { date: '2025-04-10', name: 'Mahavir Jayanti' },
  { date: '2025-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti' },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-05-01', name: 'Maharashtra Day' },
  { date: '2025-08-15', name: 'Independence Day' },
  { date: '2025-08-27', name: 'Ganesh Chaturthi' },
  { date: '2025-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2025-10-21', name: 'Diwali Laxmi Pujan', hasMuhuratTrading: true },
  { date: '2025-10-22', name: 'Diwali Balipratipada' },
  { date: '2025-11-05', name: 'Guru Nanak Jayanti' },
  { date: '2025-12-25', name: 'Christmas' },

  // 2026
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-02-16', name: 'Mahashivratri' },
  { date: '2026-03-03', name: 'Holi' },
  { date: '2026-03-20', name: 'Id-Ul-Fitr' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti' },
  { date: '2026-05-01', name: 'Maharashtra Day' },
  { date: '2026-05-28', name: 'Bakri Id' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-09-15', name: 'Ganesh Chaturthi' },
  { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-09', name: 'Diwali Laxmi Pujan', hasMuhuratTrading: true },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
  { date: '2026-12-25', name: 'Christmas' },
];

const HOLIDAY_MAP = new Map<string, HolidayEntry>(
  NSE_TRADING_HOLIDAYS.map((h) => [h.date, h])
);

/**
 * Checks if a given date (or date string YYYY-MM-DD) in IST is an NSE trading holiday.
 */
export function isNseHoliday(date: Date | string): {
  isHoliday: boolean;
  holiday?: HolidayEntry;
} {
  let dateStr: string;
  if (typeof date === 'string') {
    dateStr = date.substring(0, 10);
  } else {
    // Format to Asia/Kolkata date string YYYY-MM-DD
    const istStr = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // en-CA gives YYYY-MM-DD
    dateStr = istStr;
  }

  const holiday = HOLIDAY_MAP.get(dateStr);
  return {
    isHoliday: !!holiday,
    holiday,
  };
}
