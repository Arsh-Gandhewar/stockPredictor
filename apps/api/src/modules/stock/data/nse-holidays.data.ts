/**
 * National Stock Exchange (NSE) Official Trading Holiday Calendar & Session Engine
 * Backed by cryptographic checksum-verified governance artifact (2024-2027).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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

  // 2027
  { date: '2027-01-26', name: 'Republic Day' },
  { date: '2027-03-08', name: 'Mahashivratri' },
  { date: '2027-03-22', name: 'Holi' },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-04-14', name: 'Dr. Ambedkar Jayanti' },
  { date: '2027-05-01', name: 'Maharashtra Day' },
  { date: '2027-08-15', name: 'Independence Day' },
  { date: '2027-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2027-10-29', name: 'Diwali Laxmi Pujan', hasMuhuratTrading: true },
  { date: '2027-11-13', name: 'Guru Nanak Jayanti' },
  { date: '2027-12-25', name: 'Christmas' },
];

export const CALENDAR_VERSION = '2026.1';
export const SUPPORTED_CALENDAR_YEARS = [2024, 2025, 2026, 2027];

export interface CalendarIntegrityResult {
  isValid: boolean;
  checksum: string;
  version: string;
  error?: string;
  holidays?: HolidayEntry[];
}

/**
 * Loads and verifies the cryptographic checksum and schema of the governance calendar artifact.
 * Any missing file, parse error, version mismatch, or checksum tampering fails closed.
 */
export function verifyCalendarArtifact(): CalendarIntegrityResult {
  try {
    const artifactPath = path.resolve(
      __dirname,
      '../../../../data/artifacts/governance/nse-calendar-v2026.1.json',
    );
    if (!fs.existsSync(artifactPath)) {
      return {
        isValid: false,
        checksum: '',
        version: CALENDAR_VERSION,
        error: 'CALENDAR_ARTIFACT_MISSING',
      };
    }
    const raw = fs.readFileSync(artifactPath, 'utf-8');
    if (!raw || raw.trim().length === 0) {
      return {
        isValid: false,
        checksum: '',
        version: CALENDAR_VERSION,
        error: 'CALENDAR_ARTIFACT_EMPTY',
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        isValid: false,
        checksum: '',
        version: CALENDAR_VERSION,
        error: 'CALENDAR_ARTIFACT_PARSE_FAILED',
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        isValid: false,
        checksum: '',
        version: CALENDAR_VERSION,
        error: 'CALENDAR_ARTIFACT_MALFORMED',
      };
    }

    if (parsed.calendarVersion !== CALENDAR_VERSION) {
      return {
        isValid: false,
        checksum: parsed.checksum || '',
        version: parsed.calendarVersion || 'UNKNOWN',
        error: `CALENDAR_VERSION_MISMATCH: expected '${CALENDAR_VERSION}', got '${parsed.calendarVersion}'`,
      };
    }

    if (!Array.isArray(parsed.holidays) || parsed.holidays.length === 0) {
      return {
        isValid: false,
        checksum: parsed.checksum || '',
        version: parsed.calendarVersion,
        error: 'CALENDAR_DATA_EMPTY',
      };
    }

    const { checksum, ...canonicalDoc } = parsed;
    const computedHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(canonicalDoc))
      .digest('hex');
    if (computedHash !== checksum) {
      return {
        isValid: false,
        checksum,
        version: parsed.calendarVersion || CALENDAR_VERSION,
        error: 'CALENDAR_CHECKSUM_MISMATCH',
      };
    }

    return {
      isValid: true,
      checksum,
      version: parsed.calendarVersion,
      holidays: parsed.holidays,
    };
  } catch (err: any) {
    return {
      isValid: false,
      checksum: '',
      version: CALENDAR_VERSION,
      error: err.message,
    };
  }
}

let runtimeHolidayMap: Map<string, HolidayEntry> | null = null;
let runtimeSupportedYears: number[] = [];
let lastIntegrityResult: CalendarIntegrityResult | null = null;
let lastCheckTimestamp = 0;

/**
 * Returns verified runtime calendar state. If the governance artifact is missing,
 * corrupted, or tampered, the calendar fails closed immediately.
 */
export function getVerifiedCalendar(): {
  integrity: CalendarIntegrityResult;
  holidayMap: Map<string, HolidayEntry>;
  supportedYears: number[];
} {
  const now = Date.now();
  if (
    runtimeHolidayMap &&
    lastIntegrityResult?.isValid &&
    now - lastCheckTimestamp < 5000
  ) {
    return {
      integrity: lastIntegrityResult,
      holidayMap: runtimeHolidayMap,
      supportedYears: runtimeSupportedYears,
    };
  }

  const integrity = verifyCalendarArtifact();
  lastIntegrityResult = integrity;
  lastCheckTimestamp = now;

  if (!integrity.isValid || !integrity.holidays) {
    runtimeHolidayMap = new Map();
    runtimeSupportedYears = [];
    return {
      integrity,
      holidayMap: runtimeHolidayMap,
      supportedYears: runtimeSupportedYears,
    };
  }

  const map = new Map<string, HolidayEntry>();
  const yearsSet = new Set<number>();
  for (const h of integrity.holidays) {
    map.set(h.date, h);
    const y = parseInt(h.date.substring(0, 4), 10);
    if (!isNaN(y)) yearsSet.add(y);
  }

  runtimeHolidayMap = map;
  runtimeSupportedYears = Array.from(yearsSet).sort((a, b) => a - b);
  return {
    integrity,
    holidayMap: runtimeHolidayMap,
    supportedYears: runtimeSupportedYears,
  };
}

/**
 * Registers new or updated holiday entries dynamically at runtime.
 */
export function registerHolidays(entries: HolidayEntry[]): void {
  const { holidayMap, supportedYears } = getVerifiedCalendar();
  for (const entry of entries) {
    holidayMap.set(entry.date, entry);
    const year = parseInt(entry.date.substring(0, 4), 10);
    if (!isNaN(year) && !supportedYears.includes(year)) {
      supportedYears.push(year);
      supportedYears.sort((a, b) => a - b);
    }
  }
}

/**
 * Checks if a date falls outside the actively maintained calendar boundary.
 */
export function isCalendarStale(date: Date | string): boolean {
  const { integrity, supportedYears } = getVerifiedCalendar();
  if (!integrity.isValid || supportedYears.length === 0) return true;

  let year: number;
  if (typeof date === 'string') {
    year = parseInt(date.substring(0, 4), 10);
  } else {
    const istStr = date.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata',
    });
    year = parseInt(istStr.substring(0, 4), 10);
  }
  const minYear = Math.min(...supportedYears);
  const maxYear = Math.max(...supportedYears);
  return isNaN(year) || year < minYear || year > maxYear;
}

export interface HolidayCheckResult {
  isHoliday: boolean;
  holiday?: HolidayEntry;
  isCalendarStale: boolean;
  calendarVersion: string;
  isMuhuratSession?: boolean;
}

/**
 * Checks if a given date (or date string YYYY-MM-DD) in IST is an NSE trading holiday,
 * including detection of calendar staleness and Muhurat trading sessions.
 */
export function isNseHoliday(date: Date | string): HolidayCheckResult {
  let dateStr: string;
  let timeInMinutes = -1;

  if (typeof date === 'string') {
    dateStr = date.substring(0, 10);
    if (date.length > 10) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const istTimeStr = d.toLocaleString('en-US', {
          timeZone: 'Asia/Kolkata',
        });
        const istDate = new Date(istTimeStr);
        timeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
      }
    }
  } else {
    // Format to Asia/Kolkata date string YYYY-MM-DD
    const istStr = date.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata',
    });
    dateStr = istStr;
    const istTimeStr = date.toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
    });
    const istDate = new Date(istTimeStr);
    timeInMinutes = istDate.getHours() * 60 + istDate.getMinutes();
  }

  const { integrity, holidayMap } = getVerifiedCalendar();
  if (!integrity.isValid) {
    return {
      isHoliday: false,
      holiday: undefined,
      isCalendarStale: true,
      calendarVersion: CALENDAR_VERSION,
      isMuhuratSession: false,
    };
  }

  const calendarStale = isCalendarStale(dateStr);
  const holiday = holidayMap.get(dateStr);

  // Muhurat trading session: 18:00 to 19:15 IST (1080 to 1155 minutes)
  const isMuhuratSession = !!(
    holiday?.hasMuhuratTrading &&
    timeInMinutes >= 1080 &&
    timeInMinutes <= 1155
  );

  return {
    isHoliday: !!holiday,
    holiday,
    isCalendarStale: calendarStale,
    calendarVersion: CALENDAR_VERSION,
    isMuhuratSession,
  };
}

export type TradingSessionType =
  | 'REGULAR'
  | 'PRE_MARKET'
  | 'POST_MARKET'
  | 'MUHURAT'
  | 'HOLIDAY'
  | 'WEEKEND'
  | 'CLOSED'
  | 'CALENDAR_STALE'
  | 'CALENDAR_CORRUPTED';

export interface AuthoritativeSessionClassification {
  sessionType: TradingSessionType;
  isTradable: boolean;
  status:
    | 'OPEN'
    | 'PRE_OPEN'
    | 'CLOSED'
    | 'HOLIDAY'
    | 'CALENDAR_STALE'
    | 'CALENDAR_CORRUPTED';
  isCalendarStale: boolean;
  holidayName?: string;
  calendarVersion: string;
}

/**
 * Provides authoritative session classification ensuring every supported date/time has exactly
 * one deterministic session state.
 */
export function classifyTradingSession(
  referenceDate?: Date,
): AuthoritativeSessionClassification {
  const now = referenceDate || new Date();

  // Verify calendar artifact integrity - any failure fails closed immediately
  const integrity = verifyCalendarArtifact();
  if (!integrity.isValid) {
    return {
      sessionType: 'CALENDAR_CORRUPTED',
      isTradable: false,
      status: 'CALENDAR_CORRUPTED',
      isCalendarStale: true,
      calendarVersion: CALENDAR_VERSION,
    };
  }

  const istTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istTimeStr);

  const day = istDate.getDay(); // 0 = Sun, 6 = Sat
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  const holidayCheck = isNseHoliday(now);

  if (holidayCheck.isCalendarStale) {
    return {
      sessionType: 'CALENDAR_STALE',
      isTradable: false,
      status: 'CALENDAR_STALE',
      isCalendarStale: true,
      calendarVersion: holidayCheck.calendarVersion,
    };
  }

  if (holidayCheck.isMuhuratSession) {
    return {
      sessionType: 'MUHURAT',
      isTradable: true,
      status: 'OPEN',
      holidayName: holidayCheck.holiday?.name,
      isCalendarStale: false,
      calendarVersion: holidayCheck.calendarVersion,
    };
  }

  if (holidayCheck.isHoliday) {
    return {
      sessionType: 'HOLIDAY',
      isTradable: false,
      status: 'HOLIDAY',
      holidayName: holidayCheck.holiday?.name,
      isCalendarStale: false,
      calendarVersion: holidayCheck.calendarVersion,
    };
  }

  if (day === 0 || day === 6) {
    return {
      sessionType: 'WEEKEND',
      isTradable: false,
      status: 'CLOSED',
      isCalendarStale: false,
      calendarVersion: holidayCheck.calendarVersion,
    };
  }

  // Pre-market: 09:00 to 09:15 IST
  if (timeInMinutes >= 540 && timeInMinutes < 555) {
    return {
      sessionType: 'PRE_MARKET',
      isTradable: false,
      status: 'PRE_OPEN',
      isCalendarStale: false,
      calendarVersion: holidayCheck.calendarVersion,
    };
  }

  // Regular Trading Hours: 09:15 to 15:30 IST
  if (timeInMinutes >= 555 && timeInMinutes <= 930) {
    return {
      sessionType: 'REGULAR',
      isTradable: true,
      status: 'OPEN',
      isCalendarStale: false,
      calendarVersion: holidayCheck.calendarVersion,
    };
  }

  // Post-market: 15:40 to 16:00 IST
  if (timeInMinutes >= 940 && timeInMinutes <= 960) {
    return {
      sessionType: 'POST_MARKET',
      isTradable: false,
      status: 'CLOSED',
      isCalendarStale: false,
      calendarVersion: holidayCheck.calendarVersion,
    };
  }

  return {
    sessionType: 'CLOSED',
    isTradable: false,
    status: 'CLOSED',
    isCalendarStale: false,
    calendarVersion: holidayCheck.calendarVersion,
  };
}
