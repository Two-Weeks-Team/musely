// An incoming empty HTTP write can have a non-null, already closed body stream.
export async function emptyWriteBody(request: Request): Promise<boolean> {
  if (!request.body) return true;
  const reader = request.body.getReader(); let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body_deadline')), 1000); });
  try {
    for (let i = 0; i < 8; i++) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) return true;
      if (part.value.byteLength) return false;
    }
    return false;
  } catch { return false; } finally { if (timer !== undefined) clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
