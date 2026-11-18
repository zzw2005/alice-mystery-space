// Decode one frame through the installed Chromium media stack, one clip at a time.
export async function probeClips(clips: Record<string, string>, timeoutMs: number) {
  const video = document.createElement('video');
  video.muted = true;
  const results: Record<string, string> = {};
  for (const [name, url] of Object.entries(clips)) {
    let timer = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = window.setTimeout(() => reject(Error('decode timeout')), timeoutMs);
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(Error(video.error?.message || 'decode failed'));
        video.src = url; video.load();
      });
      results[name] = 'ok';
    } catch (error) { results[name] = String(error); }
    finally {
      clearTimeout(timer); video.onloadeddata = video.onerror = null;
      video.removeAttribute('src'); video.load();
    }
  }
  return results;
}
