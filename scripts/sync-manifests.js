const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const prodManifestPath = path.join(repoRoot, 'quantx-production-manifest.json');
const runtimeManifestPath = path.join(repoRoot, 'packages', 'quant-engine', 'research', 'quantx_runtime_manifest.json');
const auditResultsPath = path.join(repoRoot, 'audit-results.json');
const canonicalFeaturesPath = path.join(repoRoot, 'packages', 'quant-engine', 'research', 'canonical_features.json');

function getGitSha() {
  if (process.env.QUANTX_GIT_SHA) return process.env.QUANTX_GIT_SHA.trim();
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch (err) {
    return '0000000000000000000000000000000000000000';
  }
}

function getGitTreeSha() {
  try {
    return execSync('git log -1 --format=%T', { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch {
    return '0000000000000000000000000000000000000000';
  }
}

function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function syncManifests(isVerifyOnly = false) {
  const headSha = getGitSha();
  const treeSha = getGitTreeSha();
  console.log('[sync-manifests] Active Git HEAD SHA: ' + headSha);
  console.log('[sync-manifests] Active Git Tree SHA: ' + treeSha);

  if (!fs.existsSync(prodManifestPath)) throw new Error('Missing ' + prodManifestPath);
  if (!fs.existsSync(runtimeManifestPath)) throw new Error('Missing ' + runtimeManifestPath);
  if (!fs.existsSync(auditResultsPath)) throw new Error('Missing ' + auditResultsPath);

  const prodManifest = JSON.parse(fs.readFileSync(prodManifestPath, 'utf-8'));
  const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf-8'));
  const auditResults = JSON.parse(fs.readFileSync(auditResultsPath, 'utf-8'));

  const featureSchemaHash = computeFileHash(canonicalFeaturesPath);
  console.log('[sync-manifests] Canonical Feature Schema SHA-256: ' + featureSchemaHash);

  if (isVerifyOnly) {
    const mismatches = [];
    if (prodManifest.lineage.featureHash !== featureSchemaHash) {
      mismatches.push('Production manifest featureHash != canonical_features.json hash');
    }
    if (runtimeManifest.lineageHashes.featureHash !== featureSchemaHash) {
      mismatches.push('Runtime manifest featureHash != canonical_features.json hash');
    }
    if ('gitSha' in prodManifest || 'treeSha' in prodManifest) {
      mismatches.push('In-tree quantx-production-manifest.json must not contain self-referential gitSha/treeSha');
    }
    if ('gitSha' in runtimeManifest || 'treeSha' in runtimeManifest) {
      mismatches.push('In-tree quantx_runtime_manifest.json must not contain self-referential gitSha/treeSha');
    }
    if ('gitSha' in auditResults || 'treeSha' in auditResults) {
      mismatches.push('In-tree audit-results.json must not contain self-referential gitSha/treeSha');
    }

    const certDir = path.join(repoRoot, 'dist', 'certification');
    const attestationPath = path.join(certDir, 'quantx-attestation.json');
    if (fs.existsSync(attestationPath)) {
      const attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf-8'));
      if (attestation.target.gitSha !== headSha) {
        mismatches.push(`Certified release attestation gitSha (${attestation.target.gitSha}) != HEAD (${headSha})`);
      }
      if (attestation.target.treeSha !== treeSha) {
        mismatches.push(`Certified release attestation treeSha (${attestation.target.treeSha}) != HEAD tree (${treeSha})`);
      }
    }

    if (mismatches.length > 0) {
      console.error('[sync-manifests] Verification FAILED:\n' + mismatches.join('\n'));
      process.exit(1);
    }
    console.log('[sync-manifests] All in-tree specifications and external release attestations verified successfully.');
    return;
  }

  // 1. In-tree specifications: pure declarative content hashes without self-referential tree/git SHA
  delete prodManifest.gitSha;
  delete prodManifest.treeSha;
  delete prodManifest.attestationMode;
  prodManifest.lineage.featureHash = featureSchemaHash;
  fs.writeFileSync(prodManifestPath, JSON.stringify(prodManifest, null, 2) + '\n', 'utf-8');

  delete runtimeManifest.gitSha;
  delete runtimeManifest.treeSha;
  delete runtimeManifest.attestationMode;
  runtimeManifest.lineageHashes.featureHash = featureSchemaHash;
  fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + '\n', 'utf-8');

  delete auditResults.gitSha;
  delete auditResults.treeSha;
  delete auditResults.attestationMode;
  fs.writeFileSync(auditResultsPath, JSON.stringify(auditResults, null, 2) + '\n', 'utf-8');

  // 2. External release attestation: generated post-commit in dist/certification/ outside the source tree
  const certDir = path.join(repoRoot, 'dist', 'certification');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  const attestationRecord = {
    attestationSchema: '1.0.0',
    attestedAt: new Date().toISOString(),
    target: {
      gitSha: headSha,
      treeSha: treeSha
    },
    lineageHashes: {
      ...prodManifest.lineage,
      featureHash: featureSchemaHash
    },
    certification: prodManifest.certification
  };

  fs.writeFileSync(path.join(certDir, 'quantx-attestation.json'), JSON.stringify(attestationRecord, null, 2) + '\n', 'utf-8');
  console.log('[sync-manifests] In-tree manifests maintained purely declarative. Generated external release attestation in dist/certification/quantx-attestation.json for commit ' + headSha + ' (tree ' + treeSha + ').');
}

const isVerify = process.argv.includes('--verify');
try {
  syncManifests(isVerify);
} catch (err) {
  console.error('[sync-manifests] Error: ' + err.message);
  process.exit(1);
}
