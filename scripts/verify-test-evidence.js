const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HMAC_SECRET = 'quantx-gov-ci-salt-2026-v5-1';
const evidencePath = path.resolve(__dirname, '../apps/api/data/artifacts/governance/test-evidence.json');

if (!fs.existsSync(evidencePath)) {
  console.error('❌ test-evidence.json not found at ' + evidencePath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
if (!data.signature) {
  console.error('❌ test-evidence.json lacks signature');
  process.exit(1);
}

const canonical = JSON.stringify({
  commitSha: data.commitSha,
  evaluatedAt: data.evaluatedAt,
  suites: data.suites,
  overallPassed: data.overallPassed,
});

const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(canonical).digest('hex');

if (data.signature !== expectedSig) {
  console.error('❌ test-evidence.json signature mismatch!');
  console.error(`Expected: ${expectedSig}`);
  console.error(`Actual:   ${data.signature}`);
  process.exit(1);
}

console.log('✅ test-evidence.json signature verified successfully.');
console.log(`Commit: ${data.commitSha}`);
console.log(`Jest:   ${data.suites.jest.passedTests}/${data.suites.jest.totalTests} passed`);
console.log(`Pytest: ${data.suites.pytest.passedTests}/${data.suites.pytest.totalTests} passed`);
