/**
 * Encode a safe Content-Disposition header for downloads from authenticated R2.
 * The ASCII fallback is constant and the user-supplied name only appears in
 * RFC 5987 filename*, percent-encoded to prevent header injection.
 */
export function mediaDownloadHeader(title: string | null | undefined, mime: string) {
  const extensions: Record<string,string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  const ext = extensions[mime] ?? 'bin';
  const safe = String(title ?? '')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .trim()
    .slice(0, 120) || 'babymemo';
  const name = /\.[a-z0-9]{1,6}$/i.test(safe) ? safe : safe + '.' + ext;
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, char =>
    '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return 'attachment; filename="babymemo.' + ext + '"; filename*=UTF-8' + "''" + encoded;
}
