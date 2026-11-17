// Ignore detached Zzz/hearts as well as the fully transparent background.
export function bodyMask(rgba: Uint8ClampedArray, width: number, height: number, labels: Int32Array, queue: Int32Array): number {
  labels.fill(0);
  let component = 0, largest = 0, maxSize = 0;
  const offsets = [-1, 1, -width, width];
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (labels[pixel] || rgba[pixel * 4 + 3] <= 12) continue;
    component++;
    let read = 0, count = 1; queue[0] = pixel; labels[pixel] = component;
    while (read < count) {
      const p = queue[read++], x = p % width;
      for (const offset of offsets) {
        if ((offset === -1 && x === 0) || (offset === 1 && x === width - 1)) continue;
        const neighbor = p + offset;
        if (neighbor < 0 || neighbor >= labels.length || labels[neighbor] || rgba[neighbor * 4 + 3] <= 12) continue;
        labels[neighbor] = component; queue[count++] = neighbor;
      }
    }
    if (count > maxSize) { maxSize = count; largest = component; }
  }
  return largest;
}
