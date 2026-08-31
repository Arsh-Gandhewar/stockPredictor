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
    throw new Error('Failed to get git HEAD SHA: ' + err.message);
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
    if (prodManifest.gitSha !== headSha) {
      mismatches.push(`Production manifest gitSha (${prodManifest.gitSha}) != HEAD (${headSha})`);
    }
    if (prodManifest.treeSha !== treeSha) {
      mismatches.push(`Production manifest treeSha (${prodManifest.treeSha}) != HEAD tree (${treeSha})`);
    }
    if (runtimeManifest.gitSha !== headSha) {
      mismatches.push(`Runtime manifest gitSha (${runtimeManifest.gitSha}) != HEAD (${headSha})`);
    }
    if (runtimeManifest.treeSha !== treeSha) {
      mismatches.push(`Runtime manifest treeSha (${runtimeManifest.treeSha}) != HEAD tree (${treeSha})`);
    }
    if (auditResults.gitSha !== headSha) {
      mismatches.push(`Audit results gitSha (${auditResults.gitSha}) != HEAD (${headSha})`);
    }
    if (auditResults.treeSha !== treeSha) {
      mismatches.push(`Audit results treeSha (${auditResults.treeSha}) != HEAD tree (${treeSha})`);
    }
    if (prodManifest.lineage.featureHash !== featureSchemaHash) {
      mismatches.push('Production manifest featureHash != canonical_features.json hash');
    }

    if (mismatches.length > 0) {
      console.error('[sync-manifests] Verification FAILED:\n' + mismatches.join('\n'));
      process.exit(1);
    }
    console.log('[sync-manifests] All manifests verified successfully against active commit/tree and lineage.');
    return;
  }

  prodManifest.gitSha = headSha;
  prodManifest.treeSha = treeSha;
  prodManifest.lineage.featureHash = featureSchemaHash;
  fs.writeFileSync(prodManifestPath, JSON.stringify(prodManifest, null, 2) + '\n', 'utf-8');

  runtimeManifest.gitSha = headSha;
  runtimeManifest.treeSha = treeSha;
  runtimeManifest.lineageHashes.featureHash = featureSchemaHash;
  fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + '\n', 'utf-8');

  auditResults.gitSha = headSha;
  auditResults.treeSha = treeSha;
  fs.writeFileSync(auditResultsPath, JSON.stringify(auditResults, null, 2) + '\n', 'utf-8');

  // Also emit post-commit build/release certification artifact directory
  const certDir = path.join(repoRoot, 'dist', 'certification');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }
  fs.writeFileSync(path.join(certDir, 'audit-results.json'), JSON.stringify(auditResults, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(path.join(certDir, 'quantx-production-manifest.json'), JSON.stringify(prodManifest, null, 2) + '\n', 'utf-8');

  console.log('[sync-manifests] Successfully synchronized gitSha ' + headSha + ' and treeSha ' + treeSha + ' across all manifests.');
}

const isVerify = process.argv.includes('--verify');
try {
  syncManifests(isVerify);
} catch (err) {
  console.error('[sync-manifests] Error: ' + err.message);
  process.exit(1);
}
