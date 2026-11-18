// Decode one frame through the installed Chromium media stack, one clip at a time.
export async function probeClips(clips: Record<string, string>, timeoutMs: number) {
  const video = document.createElement('video');
  video.muted = true;
  const results: Record<string, string> = {};
  for (const [name, url] of Object.entries(clips)) {
    let timer = 0;
    try {
      results[name] = await new Promise<string>(resolve => {
        timer = window.setTimeout(() => resolve('decode-timeout'), timeoutMs);
        video.onloadeddata = () => resolve('ok');
        video.onerror = () => resolve('decode-failed');
        video.src = url; video.load();
      });
    } finally {
      clearTimeout(timer); video.onloadeddata = video.onerror = null;
      video.removeAttribute('src'); video.load();
    }
  }
  return results;
}
