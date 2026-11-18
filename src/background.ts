import { readSettings, normalize, type Status, type Stored } from "./state";
const reports = new Map<
  number,
  Map<number, { status: Status; time: number }>
>();
chrome.tabs.onRemoved.addListener((id) => reports.delete(id));
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === "loading") reports.delete(id);
});
async function handle(m: any, sender: chrome.runtime.MessageSender) {
  const tab = sender.tab?.id ?? m.tab;
  if (m.type === "report" && sender.tab?.id !== undefined) {
    const frames = reports.get(tab) || new Map();
    frames.set(sender.frameId ?? 0, { status: m.status, time: Date.now() });
    reports.set(tab, frames);
    const winner = [...frames]
      .filter(([, r]) => Date.now() - r.time < 4000 && r.status.score >= 0)
      .sort((a, b) => (b[1].status.score || 0) - (a[1].status.score || 0))[0];
    await Promise.all(
      [...frames.keys()].map((frameId) =>
        chrome.tabs
          .sendMessage(
            tab,
            { type: "select", active: frameId === winner?.[0] },
            { frameId },
          )
          .catch(() => {}),
      ),
    );
    return;
  }
  if (m.type === "status") {
    const frames = reports.get(tab);
    const best =
      frames &&
      [...frames.values()]
        .filter((r) => Date.now() - r.time < 4000)
        .sort((a, b) => (b.status.score ?? -1) - (a.status.score ?? -1))[0];
    return (
      best?.status ?? {
        state: "No video detected",
        detail: "Play a video on this page",
      }
    );
  }
  if (m.type === "settings") {
    if (m.site) {
      const { sites = {} } = await chrome.storage.local.get<Stored>("sites");
      sites[m.site] = normalize(m.value);
      await chrome.storage.local.set({ sites });
    } else await chrome.storage.local.set({ settings: normalize(m.value) });
    return true;
  }
  if (m.type === "read") return readSettings(m.site);
}
chrome.runtime.onMessage.addListener((m, s, r) => {
  handle(m, s)
    .then(r)
    .catch(() => r(null));
  return true;
});
