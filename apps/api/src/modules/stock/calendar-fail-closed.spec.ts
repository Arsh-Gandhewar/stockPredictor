import { ServiceUnavailableException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  verifyCalendarArtifact,
  classifyTradingSession,
  getVerifiedCalendar,
  CALENDAR_VERSION,
} from './data/nse-holidays.data';
import { PortfolioService } from '../portfolio/portfolio.service';

describe('P0 Invariant: Fail-Closed Calendar Verification Spec', () => {
  const artifactPath = path.resolve(
    __dirname,
    '../../../data/artifacts/governance/nse-calendar-v2026.1.json',
  );
  let originalContent: string;

  beforeAll(() => {
    originalContent = fs.readFileSync(artifactPath, 'utf-8');
  });

  afterEach(() => {
    // Always restore the genuine artifact after each failure-injection test
    fs.writeFileSync(artifactPath, originalContent, 'utf-8');
  });

  afterAll(() => {
    fs.writeFileSync(artifactPath, originalContent, 'utf-8');
  });

  it('1. Genuine verified artifact passes checksum and integrity validation', () => {
    const result = verifyCalendarArtifact();
    expect(result.isValid).toBe(true);
    expect(result.version).toBe(CALENDAR_VERSION);
    expect(result.holidays).toBeDefined();
    expect(result.holidays!.length).toBeGreaterThan(0);

    const verified = getVerifiedCalendar();
    expect(verified.integrity.isValid).toBe(true);
    expect(verified.holidayMap.size).toBeGreaterThan(0);
    expect(verified.supportedYears).toContain(2026);
  });

  it('2. Missing calendar artifact fails closed: marks session CALENDAR_CORRUPTED and non-tradable', () => {
    // Delete artifact
    fs.unlinkSync(artifactPath);

    const integrity = verifyCalendarArtifact();
    expect(integrity.isValid).toBe(false);
    expect(integrity.error).toBe('CALENDAR_ARTIFACT_MISSING');

    const session = classifyTradingSession(
      new Date('2026-06-15T10:00:00.000Z'),
    );
    expect(session.sessionType).toBe('CALENDAR_CORRUPTED');
    expect(session.isTradable).toBe(false);
    expect(session.status).toBe('CALENDAR_CORRUPTED');
    expect(session.isCalendarStale).toBe(true);
  });

  it('3. Checksum tampered artifact fails closed with CALENDAR_CHECKSUM_MISMATCH', () => {
    // Tamper with content (alter holiday name)
    const tampered = originalContent.replace('Republic Day', 'Tampered Day');
    fs.writeFileSync(artifactPath, tampered, 'utf-8');

    const integrity = verifyCalendarArtifact();
    expect(integrity.isValid).toBe(false);
    expect(integrity.error).toBe('CALENDAR_CHECKSUM_MISMATCH');

    const session = classifyTradingSession(
      new Date('2026-01-26T10:00:00.000Z'),
    );
    expect(session.sessionType).toBe('CALENDAR_CORRUPTED');
    expect(session.isTradable).toBe(false);
    expect(session.status).toBe('CALENDAR_CORRUPTED');
  });

  it('4. Malformed JSON syntax in artifact fails closed with CALENDAR_ARTIFACT_PARSE_FAILED', () => {
    fs.writeFileSync(
      artifactPath,
      '{ "calendarVersion": "2026.1", corrupt_json',
      'utf-8',
    );

    const integrity = verifyCalendarArtifact();
    expect(integrity.isValid).toBe(false);
    expect(integrity.error).toBe('CALENDAR_ARTIFACT_PARSE_FAILED');

    const session = classifyTradingSession(
      new Date('2026-06-15T10:00:00.000Z'),
    );
    expect(session.sessionType).toBe('CALENDAR_CORRUPTED');
    expect(session.isTradable).toBe(false);
    expect(session.status).toBe('CALENDAR_CORRUPTED');
  });

  it('5. Truncated empty artifact fails closed with CALENDAR_ARTIFACT_EMPTY', () => {
    fs.writeFileSync(artifactPath, '', 'utf-8');

    const integrity = verifyCalendarArtifact();
    expect(integrity.isValid).toBe(false);
    expect(integrity.error).toBe('CALENDAR_ARTIFACT_EMPTY');

    const session = classifyTradingSession(
      new Date('2026-06-15T10:00:00.000Z'),
    );
    expect(session.sessionType).toBe('CALENDAR_CORRUPTED');
    expect(session.isTradable).toBe(false);
    expect(session.status).toBe('CALENDAR_CORRUPTED');
  });

  it('6. Version mismatch artifact fails closed with CALENDAR_VERSION_MISMATCH', () => {
    const mismatched = JSON.parse(originalContent);
    mismatched.calendarVersion = '1999.0';
    fs.writeFileSync(
      artifactPath,
      JSON.stringify(mismatched, null, 2),
      'utf-8',
    );

    const integrity = verifyCalendarArtifact();
    expect(integrity.isValid).toBe(false);
    expect(integrity.error).toContain('CALENDAR_VERSION_MISMATCH');

    const session = classifyTradingSession(
      new Date('2026-06-15T10:00:00.000Z'),
    );
    expect(session.sessionType).toBe('CALENDAR_CORRUPTED');
    expect(session.isTradable).toBe(false);
  });

  it('7. PortfolioService rejects trades with 503 when calendar is corrupted or unverified', async () => {
    const mockDb: any = { client: {} };
    const mockStockService: any = {
      getMarketStatusInfo: jest.fn().mockReturnValue({
        status: 'CALENDAR_CORRUPTED',
        sessionType: 'CALENDAR_CORRUPTED',
        isCalendarStale: true,
        isTradable: false,
        calendarVersion: '2026.1',
      }),
      isSupportedTicker: jest.fn().mockReturnValue(true),
    };

    const portfolioService = new PortfolioService(
      mockDb,
      mockStockService,
      {} as any,
      {} as any,
    );

    await expect(
      portfolioService.executeTrade('user_123', 'INFY.NS', 'BUY' as any, 10),
    ).rejects.toThrow(ServiceUnavailableException);

    await expect(
      portfolioService.executeTrade('user_123', 'INFY.NS', 'BUY' as any, 10),
    ).rejects.toThrow(/EXCHANGE_CALENDAR_UNAVAILABLE/);
  });
});
