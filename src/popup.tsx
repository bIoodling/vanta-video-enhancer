import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  defaults,
  normalize,
  type Settings,
  type Status,
  type Quality,
  type Stored,
} from "./state";
import "./popup.css";
const Logo = () => (
  <svg className="logo" viewBox="0 0 40 38" aria-hidden="true">
    <defs>
      <linearGradient id="v" x1="0" x2="1">
        <stop stopColor="#f7f4ff" />
        <stop offset="1" stopColor="#9a76e8" />
      </linearGradient>
    </defs>
    <path fill="url(#v)" d="M1 3h22l-4 6H11l10 18L34 3h6L21 37z" />
  </svg>
);
const Gear = () => (
  <svg viewBox="0 0 24 24">
    <path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h5l1-3 3-1 2-4-2-2V8l-3-2-1-3z" />
    <circle cx="11.5" cy="12" r="4" />
  </svg>
);
function App() {
  const [s, setS] = useState(defaults),
    [status, setStatus] = useState<Status>({
      state: "No video detected",
      detail: "Play a video on this page",
    }),
    [warning, setWarning] = useState(false),
    [skip, setSkip] = useState(false),
    [settings, setSettings] = useState(false),
    [expanded, setExpanded] = useState(false),
    [site, setSite] = useState(""),
    [perSite, setPerSite] = useState(false);
  const tab = useRef<number | undefined>(undefined);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([t]) => {
        tab.current = t?.id;
        const host = t?.url ? new URL(t.url).hostname : "";
        setSite(host);
        const data = await chrome.storage.local.get<Stored>([
          "settings",
          "sites",
        ]);
        setPerSite(!!data.sites?.[host]);
        setS(normalize({ ...data.settings, ...data.sites?.[host] }));
      });
    const timer = setInterval(() => {
      if (tab.current !== undefined)
        void chrome.runtime
          .sendMessage({ type: "status", tab: tab.current })
          .then((r) => r && setStatus(r));
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (warning) cancel.current?.focus();
  }, [warning]);
  function save(next: Settings) {
    setS(next);
    void chrome.runtime.sendMessage({
      type: "settings",
      value: next,
      site: perSite ? site : undefined,
    });
  }
  function quality(q: Quality) {
    if (q === "ultra" && s.quality !== "ultra" && !s.skipUltra) {
      setWarning(true);
      setSkip(false);
    } else save({ ...s, quality: q });
  }
  const active = status.state === "Enhancing";
  const output = status.output;
  const scale = output ? `${output[0]} × ${output[1]}` : null;
  if (warning)
    return (
      <main
        className="warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="warning-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") setWarning(false);
          if (e.key === "Tab") {
            const els = [
              ...e.currentTarget.querySelectorAll<HTMLElement>("button,input"),
            ];
            const i = els.indexOf(document.activeElement as HTMLElement);
            els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
            e.preventDefault();
          }
        }}
      >
        <button
          className="close icon"
          aria-label="Close"
          onClick={() => setWarning(false)}
        >
          ×
        </button>
        <svg className="alert" viewBox="0 0 64 60">
          <path d="M27 6q5-9 10 0l24 43q5 9-5 9H8q-10 0-5-9z" />
          <path d="M32 20v14m0 10v1" />
        </svg>
        <h1 id="warning-title">Enable Ultra?</h1>
        <p>
          Ultra uses significantly more GPU power
          <br />
          and may cause higher temperatures,
          <br />
          fan noise, and increased power usage.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={skip}
            onChange={(e) => setSkip(e.target.checked)}
          />
          Don’t show again
        </label>
        <div className="actions">
          <button ref={cancel} onClick={() => setWarning(false)}>
            Cancel
          </button>
          <button
            className="confirm"
            onClick={() => {
              save({ ...s, quality: "ultra", skipUltra: skip });
              setWarning(false);
            }}
          >
            Enable Ultra
          </button>
        </div>
      </main>
    );
  if (s.compact && !settings)
    return (
      <main className="compact">
        <button
          className="brand"
          aria-label="Expand Vanta"
          onClick={() => save({ ...s, compact: false })}
        >
          <Logo />
        </button>
        <span className={"dot " + (active ? "green" : "")} />
        <span className="compact-text">
          {active ? `Enhancing · ${scale} (${s.quality})` : status.state}
        </span>
        <button
          className={"toggle " + (s.enabled ? "on" : "")}
          role="switch"
          aria-checked={s.enabled}
          aria-label="Enhance Video"
          onClick={() => save({ ...s, enabled: !s.enabled })}
        />
      </main>
    );
  return (
    <main>
      <header>
        <div className="brand">
          <Logo />
          <span>Vanta</span>
        </div>
        <button
          className="icon"
          aria-label={settings ? "Back" : "Settings"}
          onClick={() => setSettings(!settings)}
        >
          {settings ? "‹" : <Gear />}
        </button>
      </header>
      {settings ? (
        <section className="settings">
          <h2>Settings</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={perSite}
              onChange={async (e) => {
                const checked = e.target.checked;
                setPerSite(checked);
                if (checked) {
                  await chrome.runtime.sendMessage({
                    type: "settings",
                    value: s,
                    site,
                  });
                } else {
                  const { sites = {} } =
                    await chrome.storage.local.get<Stored>("sites");
                  delete sites[site];
                  await chrome.storage.local.set({ sites });
                  setS(
                    normalize(
                      (await chrome.storage.local.get<Stored>("settings"))
                        .settings,
                    ),
                  );
                }
              }}
            />
            Remember settings for this site
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.skipUltra}
              onChange={(e) => save({ ...s, skipUltra: e.target.checked })}
            />
            Skip Ultra warning
          </label>
          <button
            onClick={() => {
              save({ ...s, compact: true });
              setSettings(false);
            }}
          >
            Use compact view
          </button>
        </section>
      ) : (
        <>
          <section className="enhance">
            <svg className="play" viewBox="0 0 28 32">
              <path d="M3 3v26l23-13z" />
            </svg>
            <div>
              <h1>Enhance Video</h1>
              <p>Real-time upscaling &amp; cleanup</p>
            </div>
            <button
              className={"toggle " + (s.enabled ? "on" : "")}
              role="switch"
              aria-checked={s.enabled}
              aria-label="Enhance Video"
              onClick={() => save({ ...s, enabled: !s.enabled })}
            />
          </section>
          <h2>Quality</h2>
          <div className="presets">
            {(["balanced", "high", "ultra"] as Quality[]).map((q) => (
              <button
                key={q}
                aria-pressed={s.quality === q}
                className={s.quality === q ? "selected" : ""}
                onClick={() => quality(q)}
              >
                {q[0].toUpperCase() + q.slice(1)}
              </button>
            ))}
          </div>
          <h2>Scale</h2>
          <div className="select">
            <select
              aria-label="Scale"
              value={s.scale}
              onChange={(e) =>
                save({ ...s, scale: e.target.value as Settings["scale"] })
              }
            >
              <option value="auto">Auto</option>
              <option value="1080">1080p (1920 × 1080)</option>
              <option value="1440">1440p (2560 × 1440)</option>
              <option value="2160">4K (3840 × 2160)</option>
            </select>
            <span>⌄</span>
          </div>
          <button
            className="detection"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <svg viewBox="0 0 32 32">
              <rect x="2" y="4" width="28" height="20" rx="2" />
              <path d="M16 24v6m-8 0h16" />
            </svg>
            <div>
              <h3>{status.state}</h3>
              <p>
                <span className={"dot " + (status.width ? "green" : "")} />
                {status.width
                  ? `${status.width} × ${status.height}${status.fps ? ` · ${status.fps} FPS` : ""}`
                  : status.detail}
              </p>
            </div>
            <span className="chevron">{expanded ? "⌄" : "⌃"}</span>
          </button>
          {expanded && (
            <p className="details">
              {status.detail}
              {scale && <> · Output {scale}</>}
              {status.processingMs !== undefined && (
                <>
                  {" "}
                  · Submission-to-completion {status.processingMs.toFixed(1)} ms
                </>
              )}
            </p>
          )}
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
