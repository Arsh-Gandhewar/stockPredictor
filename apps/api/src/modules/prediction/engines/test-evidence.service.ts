import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface TestSuiteEvidence {
  passedSuites?: number;
  totalSuites?: number;
  passedTests: number;
  failedTests: number;
  totalTests: number;
  exitCode: number;
}

export interface TestRunEvidencePayload {
  commitSha: string;
  evaluatedAt: string;
  suites: {
    jest: TestSuiteEvidence;
    pytest: TestSuiteEvidence;
  };
  overallPassed: boolean;
}

export interface SignedTestEvidence extends TestRunEvidencePayload {
  signature: string;
}

export interface TestEvidenceValidationResult {
  isValid: boolean;
  commitSha?: string;
  jestPassed: number;
  pytestPassed: number;
  failureReasons: string[];
}

@Injectable()
export class TestEvidenceService {
  private readonly logger = new Logger(TestEvidenceService.name);
  public static readonly HMAC_SECRET = 'quantx-gov-ci-salt-2026-v5-1';
  private readonly evidencePath = path.resolve(__dirname, '../../../../data/artifacts/governance/test-evidence.json');

  public static signPayload(payload: TestRunEvidencePayload): string {
    const canonical = JSON.stringify({
      commitSha: payload.commitSha,
      evaluatedAt: payload.evaluatedAt,
      suites: payload.suites,
      overallPassed: payload.overallPassed,
    });
    return crypto.createHmac('sha256', TestEvidenceService.HMAC_SECRET).update(canonical).digest('hex');
  }

  public recordEvidence(payload: TestRunEvidencePayload): SignedTestEvidence {
    const signature = TestEvidenceService.signPayload(payload);
    const signedEvidence: SignedTestEvidence = {
      ...payload,
      signature,
    };
    const dir = path.dirname(this.evidencePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.evidencePath, JSON.stringify(signedEvidence, null, 2), 'utf-8');
    return signedEvidence;
  }

  public loadAndValidateEvidence(expectedCommitSha?: string): TestEvidenceValidationResult {
    const failureReasons: string[] = [];

    if (!fs.existsSync(this.evidencePath)) {
      return {
        isValid: false,
        jestPassed: 0,
        pytestPassed: 0,
        failureReasons: ['TEST_EVIDENCE_FILE_MISSING: No signed test-evidence.json found in governance artifacts.'],
      };
    }

    try {
      const raw = fs.readFileSync(this.evidencePath, 'utf-8');
      const data: SignedTestEvidence = JSON.parse(raw);

      if (!data.signature) {
        failureReasons.push('TEST_EVIDENCE_UNSIGNED: test-evidence.json lacks cryptographic signature.');
      } else {
        const expectedSig = TestEvidenceService.signPayload(data);
        if (data.signature !== expectedSig) {
          failureReasons.push('TEST_EVIDENCE_TAMPERED: HMAC signature mismatch in test-evidence.json.');
        }
      }

      if (expectedCommitSha && data.commitSha !== expectedCommitSha) {
        failureReasons.push(
          `TEST_EVIDENCE_COMMIT_MISMATCH: Evidence generated for commit ${data.commitSha.slice(0, 7)}, but current HEAD is ${expectedCommitSha.slice(0, 7)}.`
        );
      }

      const jest = data.suites?.jest;
      const pytest = data.suites?.pytest;

      if (!jest || jest.exitCode !== 0 || jest.failedTests > 0 || jest.passedTests === 0) {
        failureReasons.push(`JEST_SUITE_FAILURE: Jest reports ${jest?.failedTests ?? 'unknown'} failures (exit code: ${jest?.exitCode}).`);
      }

      if (!pytest || pytest.exitCode !== 0 || pytest.failedTests > 0 || pytest.passedTests === 0) {
        failureReasons.push(`PYTEST_SUITE_FAILURE: Pytest reports ${pytest?.failedTests ?? 'unknown'} failures (exit code: ${pytest?.exitCode}).`);
      }

      if (!data.overallPassed) {
        failureReasons.push('TEST_SUITE_OVERALL_FAILED: overallPassed flag is false.');
      }

      const isValid = failureReasons.length === 0;
      return {
        isValid,
        commitSha: data.commitSha,
        jestPassed: jest?.passedTests ?? 0,
        pytestPassed: pytest?.passedTests ?? 0,
        failureReasons,
      };
    } catch (err: any) {
      return {
        isValid: false,
        jestPassed: 0,
        pytestPassed: 0,
        failureReasons: [`TEST_EVIDENCE_PARSE_ERROR: ${err.message}`],
      };
    }
  }
}
