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

    const certDir = path.join(repoRoot, 'dist', 'certification');
    const certProdPath = path.join(certDir, 'quantx-production-manifest.json');
    if (fs.existsSync(certProdPath)) {
      const certProd = JSON.parse(fs.readFileSync(certProdPath, 'utf-8'));
      if (certProd.gitSha !== headSha) {
        mismatches.push(`Certified release manifest gitSha (${certProd.gitSha}) != HEAD (${headSha})`);
      }
      if (certProd.treeSha !== treeSha) {
        mismatches.push(`Certified release manifest treeSha (${certProd.treeSha}) != HEAD tree (${treeSha})`);
      }
    }

    if (mismatches.length > 0) {
      console.error('[sync-manifests] Verification FAILED:\n' + mismatches.join('\n'));
      process.exit(1);
    }
    console.log('[sync-manifests] All manifests and lineage hashes verified successfully.');
    return;
  }

  // 1. Maintain in-tree declarative manifest specifications
  prodManifest.gitSha = 'DYNAMIC_HEAD';
  prodManifest.treeSha = 'DYNAMIC_TREE';
  prodManifest.attestationMode = 'POST_BUILD_BOUND';
  prodManifest.lineage.featureHash = featureSchemaHash;
  fs.writeFileSync(prodManifestPath, JSON.stringify(prodManifest, null, 2) + '\n', 'utf-8');

  runtimeManifest.gitSha = 'DYNAMIC_HEAD';
  runtimeManifest.treeSha = 'DYNAMIC_TREE';
  runtimeManifest.attestationMode = 'POST_BUILD_BOUND';
  runtimeManifest.lineageHashes.featureHash = featureSchemaHash;
  fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + '\n', 'utf-8');

  auditResults.gitSha = 'DYNAMIC_HEAD';
  auditResults.treeSha = 'DYNAMIC_TREE';
  auditResults.attestationMode = 'POST_BUILD_BOUND';
  fs.writeFileSync(auditResultsPath, JSON.stringify(auditResults, null, 2) + '\n', 'utf-8');

  // 2. Emit immutable release certification attestation bundle into dist/certification/
  const certDir = path.join(repoRoot, 'dist', 'certification');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  const certifiedProdManifest = { ...prodManifest, gitSha: headSha, treeSha: treeSha, attestationMode: 'CERTIFIED_RELEASE' };
  const certifiedAuditResults = { ...auditResults, gitSha: headSha, treeSha: treeSha, attestationMode: 'CERTIFIED_RELEASE' };

  fs.writeFileSync(path.join(certDir, 'audit-results.json'), JSON.stringify(certifiedAuditResults, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(path.join(certDir, 'quantx-production-manifest.json'), JSON.stringify(certifiedProdManifest, null, 2) + '\n', 'utf-8');

  console.log('[sync-manifests] Successfully synchronized in-tree manifests and generated release attestation bound to gitSha ' + headSha + ' and treeSha ' + treeSha + '.');
}

const isVerify = process.argv.includes('--verify');
try {
  syncManifests(isVerify);
} catch (err) {
  console.error('[sync-manifests] Error: ' + err.message);
  process.exit(1);
}
