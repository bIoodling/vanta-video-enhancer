export function scoreVideo(v: HTMLVideoElement, interaction = 0) {
  const r = v.getBoundingClientRect(),
    s = getComputedStyle(v);
  if (
    !v.isConnected ||
    !v.videoWidth ||
    r.width < 40 ||
    r.height < 40 ||
    s.display === "none" ||
    s.visibility === "hidden" ||
    Number(s.opacity) === 0
  )
    return -1;
  const visible =
    Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
    Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  if (!visible) return -1;
  return (
    Math.log2(visible + 1) * 10 +
    (!v.paused && !v.ended ? 140 : 0) +
    (!v.muted && v.volume > 0 ? 15 : 0) +
    (Date.now() - interaction < 5000 ? 100 : 0)
  );
}
export function videos(
  root: Document | ShadowRoot = document,
): HTMLVideoElement[] {
  const result = [...root.querySelectorAll("video")];
  for (const el of root.querySelectorAll("*"))
    if (el.shadowRoot) result.push(...videos(el.shadowRoot));
  return result;
}
