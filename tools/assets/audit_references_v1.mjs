import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = JSON.parse(await readFile(path.join(root, 'references/reference-provenance-100.json'), 'utf8'));
const items = [];
for (const item of source.items) {
  const result = { assetId: item.assetId, candidateFile: item.candidateFile, status: 'IMAGE_DRAFT', issues: [] };
  const target = path.resolve(root, item.candidateFile);
  if (!target.startsWith(path.join(root, 'references') + path.sep)) throw new Error('Reference path escapes references');
  try {
    const bytes = await readFile(target);
    result.bytes = bytes.length;
    result.sha256 = createHash('sha256').update(bytes).digest('hex');
    const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (!png) result.issues.push('INVALID_PNG_HEADER');
    else { result.width = bytes.readUInt32BE(16); result.height = bytes.readUInt32BE(20); }
    for (const field of ['bytes', 'sha256', 'width', 'height']) if (result[field] !== item[field]) result.issues.push(`${field.toUpperCase()}_MISMATCH`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    result.issues.push('MISSING_FILE');
  }
  if (!item.submitId || /lost|遺失/i.test(item.submitId)) result.issues.push('SUBMIT_ID_UNVERIFIABLE');
  result.termsReview = 'PENDING';
  items.push(result);
}
const hashes = new Map();
for (const item of items) if (item.sha256) hashes.set(item.sha256, [...(hashes.get(item.sha256) ?? []), item.assetId]);
const report = {
  generatedAt: new Date().toISOString(), source: 'references/reference-provenance-100.json',
  expected: 100, listed: items.length, present: items.filter(x => x.sha256).length,
  missing: items.filter(x => x.issues.includes('MISSING_FILE')).map(x => x.assetId),
  unverifiableSubmitIds: items.filter(x => x.issues.includes('SUBMIT_ID_UNVERIFIABLE')).map(x => x.assetId),
  duplicateGroups: [...hashes].filter(([, ids]) => ids.length > 1).map(([sha256, assetIds]) => ({ sha256, assetIds })),
  termsReview: { status: 'PENDING', recordedNote: source.termsReview },
  formalReleased: 0, note: 'Reference image integrity only; this does not approve style, terms, or 3D release.', items,
};
await mkdir(path.join(root, 'working/pilot-v1'), { recursive: true });
await writeFile(path.join(root, 'working/pilot-v1/reference-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ listed: report.listed, present: report.present, missing: report.missing, unverifiableSubmitIds: report.unverifiableSubmitIds.length, duplicateGroups: report.duplicateGroups.length }));
