/**
 * Multipart upload resume planning is intentionally pure and shared by browser
 * code and Node tests. Only a matching non-empty sampled fingerprint can resume.
 */
export function pickMatchingUpload<T extends {fingerprint:string;title:string;size:number;mime:string}>(items:readonly T[], file: {fingerprint:string;title:string;size:number;mime:string}) {
  if (!/^[a-f0-9]{64}$/.test(file?.fingerprint ?? '')) return undefined;
  return items.find(item =>
    item.fingerprint === file.fingerprint &&
    item.title === file.title &&
    item.size === file.size &&
    item.mime === file.mime
  );
}
export function remainingPartNumbers(total:number, completedParts:readonly number[]) {
  if (!Number.isInteger(total) || total < 1 || total > 25) throw Error('INVALID_TOTAL');
  const valid = new Set(completedParts.filter(n => Number.isInteger(n) && n >= 1 && n <= total));
  return Array.from({length:total}, (_,i) => i+1).filter(n=>!valid.has(n));
}
