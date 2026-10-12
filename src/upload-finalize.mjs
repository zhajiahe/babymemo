/**
 * Finalize a private R2 multipart upload safely across Worker retries.
 *
 * R2 and D1 cannot share a transaction. R2's strongly consistent head() makes
 * a previously completed object discoverable on the next attempt. Never call
 * complete() again if that object already exists.
 */
export class FinalizeMismatchError extends Error {
  constructor() {
    super('UPLOAD_OBJECT_SIZE_MISMATCH');
    this.name = 'FinalizeMismatchError';
  }
}

export async function finalizeUpload({bucket, row, parts, persist, isRecorded}) {
  let object = await bucket.head(row.object_key);
  let resumedFromR2 = Boolean(object);
  if (object && object.size !== row.size) throw new FinalizeMismatchError();

  if (!object) {
    try {
      object = await bucket.resumeMultipartUpload(row.object_key, row.upload_id).complete(parts);
    } catch (error) {
      // The completion request might have committed to R2 before failing.
      // A head failure must propagate; never assume it means "missing".
      object = await bucket.head(row.object_key);
      if (!object) throw error;
      resumedFromR2 = true;
    }
  }
  if (!object || object.size !== row.size) throw new FinalizeMismatchError();

  try {
    await persist();
  } catch (error) {
    // Concurrent requests can race to commit the same D1 media row. If the
    // matching row already exists, the desired state is achieved.
    if (await isRecorded()) return {recovered: true};
    throw error;
  }
  return {recovered: resumedFromR2};
}
