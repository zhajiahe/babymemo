/** Client-side optional derivatives; original photos/videos are never modified. */
export async function fingerprintFile(file: File): Promise<string> {
  const sample = 65536;
  const first = new Uint8Array(await file.slice(0, sample).arrayBuffer());
  const last = new Uint8Array(await file.slice(Math.max(sample, file.size - sample)).arrayBuffer());
  const prefix = new TextEncoder().encode(file.name + '\0' + file.size + '\0' + (file.type || '') + '\0');
  const data = new Uint8Array(prefix.length + first.length + last.length);
  data.set(prefix);
  data.set(first, prefix.length);
  data.set(last, prefix.length + first.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, v => v.toString(16).padStart(2, '0')).join('');
}

export async function createAlbumThumbnail(file: File): Promise<Blob | null> {
  // Avoid decoding very large photographs on memory-constrained iPhones.
  if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) return null;
    const ratio = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d', {alpha: false});
    if (!ctx) return null;
    ctx.fillStyle = '#fff'; // Translucent PNG/GIF backgrounds
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (quality: number) => new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', quality));
    let result = await encode(0.76);
    if (result && result.size > 524288) result = await encode(0.52);
    return result && result.size <= 524288 ? result : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
