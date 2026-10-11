/** G3 metadata audit: verify catalog entries (id/hash/license/source) against files on disk. Read-only; machine-readable report; never rewrites catalog data. */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const root = resolve(import.meta.dirname, '../../');
const outPath = process.argv[2] ?? 'docs/evidence/2026-09-17/glm/metadata-audit.json';
const catalogs = [
  {name: 'imported-v1', file: 'packages/asset-catalog/src/imported-v1.json'},
  {name: 'animals-v1', file: 'packages/asset-catalog/src/animals-v1.json'},
  {name: 'animals-v2', file: 'packages/asset-catalog/src/animals-v2.json'},
];
const publicDir = join(root, 'apps/web/public');
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

const entries = [];
const idCounts = new Map();
for (const {name, file} of catalogs) {
  const list = JSON.parse(readFileSync(join(root, file), 'utf8'));
  for (const e of list) {
    idCounts.set(e.id, (idCounts.get(e.id) ?? 0) + 1);
    const entry = {catalog: name, id: e.id, ...Object.fromEntries(Object.entries(e))};
    entry._checks = {};
    // file existence + content hash for the GLB and thumbnail
    for (const [field, key] of [['url', 'glb'], ['thumbnail', 'thumbnail']]) {
      const rel = e[field];
      if (typeof rel !== 'string' || !rel.startsWith('/')) { entry._checks[field] = 'MISSING_FIELD'; continue; }
      const disk = join(publicDir, rel);
      if (!existsSync(disk)) { entry._checks[field] = 'FILE_MISSING'; continue; }
      entry._checks[field] = 'EXISTS';
      if (field === 'url') {
        const actual = sha256(disk);
        entry.fileBytes = statSync(disk).size;
        if (typeof e.sha256 === 'string') entry._checks.sha256 = actual === e.sha256 ? 'MATCH' : 'MISMATCH';
        else entry._checks.sha256 = 'NOT_RECORDED';
        entry.actualSha256 = actual;
        if (typeof e.bytes === 'number') entry._checks.bytes = statSync(disk).size === e.bytes ? 'MATCH' : 'MISMATCH';
      }
    }
    // provenance fields: a concrete license string is only creditable when the pack's LICENSE file exists on disk; user-provided sources stay unverified
    const license = typeof e.license === 'string' ? e.license : null;
    entry.licenseField = license;
    entry._checks.license = license ? (license === 'CC0-1.0' ? 'CC0' : 'NON_CC0_RECORDED') : 'UNKNOWN';
    const licenseFiles = {['kenney_mini-arena']: 'ARENA-LICENSE.txt', ['kenney_mini-dungeon']: 'DUNGEON-LICENSE.txt', ['kenney_furniture-kit']: 'FURNITURE-LICENSE.txt', ['kenney_mini-characters']: 'MINI-LICENSE.txt', ['Ultimate Animated Character Pack - Nov 2019']: 'ULTIMATE-LICENSE.txt'};
    const lf = licenseFiles[e.sourcePack];
    entry._checks.licenseFile = entry.catalog === 'imported-v1' ? (lf ? (existsSync(join(publicDir, 'imported-assets/v1', lf)) ? 'EXISTS' : 'FILE_MISSING') : 'NO_LICENSE_FILE_EXPECTED') : 'USER_PROVIDED';
    entry._checks.source = typeof e.source === 'string' && e.source.length > 0 ? 'RECORDED' : 'UNKNOWN';
    entry._checks.status = typeof e.status === 'string' ? e.status : 'UNKNOWN';
    // source file hash verification when recorded
    if (typeof e.sourceSha256 === 'string') {
      entry._checks.sourceSha256 = 'RECORDED_NOT_RECOMPUTABLE'; // original source file may live outside repo; do not guess
    } else entry._checks.sourceSha256 = 'UNKNOWN';
    entries.push(entry);
  }
}
// animals v1 -> v2 mapping by id
const animalsV1 = new Set(entries.filter(e => e.catalog === 'animals-v1').map(e => e.id));
const animalsV2 = new Set(entries.filter(e => e.catalog === 'animals-v2').map(e => e.id));
const v2Only = [...animalsV2].filter(id => !animalsV1.has(id));
const v1Only = [...animalsV1].filter(id => !animalsV2.has(id));
// unique asset count by content hash (catalog-recorded sha256, actual where computed)
const byContent = new Map();
for (const e of entries) {
  const h = e.actualSha256 ?? e.sha256;
  if (typeof h === 'string') byContent.set(h, [...(byContent.get(h) ?? []), `${e.catalog}/${e.id}`]);
}
const duplicatesByContent = [...byContent.entries()].filter(([, ids]) => ids.length > 1);
const summary = {
  totalEntries: entries.length,
  uniqueIds: idCounts.size,
  duplicateIds: [...idCounts.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({id, n})),
  glbHashMatch: entries.filter(e => e._checks.sha256 === 'MATCH').length,
  glbHashMismatch: entries.filter(e => e._checks.sha256 === 'MISMATCH').length,
  glbHashNotRecorded: entries.filter(e => e._checks.sha256 === 'NOT_RECORDED').length,
  glbFileMissing: entries.filter(e => e._checks.url === 'FILE_MISSING').length,
  thumbnailMissing: entries.filter(e => e._checks.thumbnail === 'FILE_MISSING').length,
  licenseCC0: entries.filter(e => e._checks.license === 'CC0').length,
  licenseNonCC0Recorded: entries.filter(e => e._checks.license === 'NON_CC0_RECORDED').length,
  licenseUnknown: entries.filter(e => e._checks.license === 'UNKNOWN').length,
  licenseFileExists: entries.filter(e => e._checks.licenseFile === 'EXISTS').length,
  licenseFileMissing: entries.filter(e => e._checks.licenseFile === 'FILE_MISSING').length,
  licenseUserProvided: entries.filter(e => e._checks.licenseFile === 'USER_PROVIDED').length,
  sourceRecorded: entries.filter(e => e._checks.source === 'RECORDED').length,
  sourceUnknown: entries.filter(e => e._checks.source === 'UNKNOWN').length,
  uniqueContentHashes: byContent.size,
  duplicateContentGroups: duplicatesByContent.map(([h, ids]) => ({sha256: h, ids})),
  animalsV1: animalsV1.size,
  animalsV2: animalsV2.size,
  animalsV2WithoutV1: v2Only,
  animalsV1WithoutV2: v1Only,
};
const report = {
  _meta: {
    tool: 'tools/assets/audit-metadata-v1.mjs',
    executed: new Date().toISOString(),
    note: 'Read-only audit. UNKNOWN stays UNKNOWN; this tool never upgrades license claims. Data audit is NOT the formal 100-asset art acceptance.',
  },
  summary,
  entries,
};
writeFileSync(resolve(root, outPath), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
