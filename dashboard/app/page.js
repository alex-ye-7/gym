"use client";

import { useState, useEffect, useCallback } from "react";
import { THEMES } from "./lib/themes";
import { SUPABASE_URL, SUPABASE_ANON_KEY, REFRESH_MS} from "./lib/constants";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend
} from "recharts";
import { Analytics } from '@vercel/analytics/next';

// Taipei is UTC+8
const parseTimestamp = (tsStr) => {
  // Handle database format: "2026-03-10 13:30:01.063+00" → ISO format
  if (typeof tsStr === 'string' && tsStr.includes(' ') && !tsStr.includes('T')) {
    tsStr = tsStr.replace(' ', 'T').replace(/\+00$/, 'Z');
  }
  return new Date(tsStr);
};

const toTaipei = (utcStr) => {
  const d = parseTimestamp(utcStr);
  return new Date(d.getTime() + 8 * 60 * 60 * 1000);
};

const fmtHHMM = (d) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

const fetchRows = async (fromISO, toISO) => {
  const url =
    `${SUPABASE_URL}/rest/v1/gym_data` +
    `?ts=gte.${encodeURIComponent(fromISO)}&ts=lte.${encodeURIComponent(toISO)}` +
    `&order=ts.asc&select=ts,count`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

// Return UTC ISO range for a given Taipei calendar day offset (0=today, -1=yesterday, -7=last week)
const taipeiDayRange = (offsetDays = 0) => {
  const nowUtc = new Date();
  const nowTaipei = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
  const y = nowTaipei.getUTCFullYear();
  const m = nowTaipei.getUTCMonth();
  const d = nowTaipei.getUTCDate() + offsetDays;
  const startTaipei = new Date(Date.UTC(y, m, d, 0, 0, 0));
  const endTaipei   = new Date(Date.UTC(y, m, d, 23, 59, 59));
  const startUtc = new Date(startTaipei.getTime() - 8 * 60 * 60 * 1000);
  const endUtc   = new Date(endTaipei.getTime()   - 8 * 60 * 60 * 1000);
  return [startUtc.toISOString(), endUtc.toISOString()];
};

const rowsToChartData = (rows) =>
  rows.map((r) => ({
    time: fmtHHMM(toTaipei(r.ts)),
    count: r.count,
    rawTs: r.ts,
  }));

// ── COMPONENTS ────────────────────────────────────────────────────────────────

const StatCard = ({ label, value, sub, color = "#e8ff47", t }) => (
  <div style={{
    background: t.cardBg, border: `1px solid ${t.borderLight}`, borderRadius: 2,
    padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4,
  }}>
    <span style={{ fontSize: 11, letterSpacing: "0.15em", color: t.textMuted, textTransform: "uppercase" }}>{label}</span>
    <span style={{ fontSize: 36, fontFamily: "'DM Mono', monospace", color, fontWeight: 500, lineHeight: 1 }}>{value ?? "—"}</span>
    {sub && <span style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>{sub}</span>}
  </div>
);

const Toggle = ({ label, active, color, onClick, t }) => (
  <button onClick={onClick} style={{
    padding: "6px 14px", fontSize: 12, letterSpacing: "0.1em",
    textTransform: "uppercase", fontFamily: "'DM Mono', monospace",
    border: `1px solid ${active ? color : t.textGhost}`,
    background: active ? color + "18" : "transparent",
    color: active ? color : t.textDim,
    borderRadius: 2, cursor: "pointer", transition: "all 0.15s",
  }}>{label}</button>
);

const CustomTooltip = ({ active, payload, label, t }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: t.tooltipBg, border: `1px solid ${t.border}`,
      padding: "10px 14px", borderRadius: 2,
    }}>
      <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 6, letterSpacing: "0.1em" }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ fontSize: 14, color: p.color, fontFamily: "'DM Mono', monospace" }}>
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  );
};

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function GymDashboard() {
  const [theme, setTheme] = useState("dark");
  const [selectedDateOffset, setSelectedDateOffset] = useState(0);
  const [selectedData,      setSelectedData]      = useState([]);
  const [yesterdayData,     setYesterdayData]     = useState([]);
  const [weekAgoData,       setWeekAgoData]       = useState([]);
  const [showYesterday,     setShowYesterday]     = useState(false);
  const [showWeekAgo,       setShowWeekAgo]       = useState(false);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState(null);
  const [lastUpdated,       setLastUpdated]       = useState(null);
  const [bestTimes,         setBestTimes]         = useState([]);

  const t = THEMES[theme];

  // Format a Taipei date label from offset
  const getDisplayDate = (offsetDays = 0) => {
    const nowUtc = new Date();
    const nowTaipei = new Date(nowUtc.getTime() + 8 * 60 * 60 * 1000);
    const d = new Date(nowTaipei.getTime());
    d.setUTCDate(d.getUTCDate() + offsetDays);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const date = String(d.getUTCDate()).padStart(2, "0");
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
    return { display: `${year}-${month}-${date}`, dow, full: `${dow}, ${year}-${month}-${date}` };
  };

  // Compute best 1-hour windows from historical data for a given day-of-week
  const computeBestTimes = (historicalRows) => {
    const slotTotals = {};
    for (const row of historicalRows) {
      const time = fmtHHMM(toTaipei(row.ts));
      if (!slotTotals[time]) slotTotals[time] = { sum: 0, count: 0 };
      slotTotals[time].sum += row.count;
      slotTotals[time].count += 1;
    }
    const slotAvgs = {};
    for (const [time, { sum, count }] of Object.entries(slotTotals)) {
      slotAvgs[time] = sum / count;
    }

    const times = Object.keys(slotAvgs).sort();
    if (times.length < 6) return [];

    const windows = [];
    for (let i = 0; i <= times.length - 6; i++) {
      const windowSlots = times.slice(i, i + 6);
      const startMin = parseInt(windowSlots[0].split(":")[0]) * 60 + parseInt(windowSlots[0].split(":")[1]);
      const endMin = parseInt(windowSlots[5].split(":")[0]) * 60 + parseInt(windowSlots[5].split(":")[1]);
      if (endMin - startMin !== 50) continue;

      const avg = windowSlots.reduce((s, time) => s + slotAvgs[time], 0) / 6;
      windows.push({
        start: windowSlots[0],
        end: (() => {
          const [h, m] = windowSlots[5].split(":").map(Number);
          const totalMin = h * 60 + m + 10;
          return `${String(Math.floor(totalMin / 60)).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
        })(),
        avg: Math.round(avg),
      });
    }

    windows.sort((a, b) => a.avg - b.avg);
    const picked = [];
    for (const w of windows) {
      const startMin = parseInt(w.start.split(":")[0]) * 60 + parseInt(w.start.split(":")[1]);
      const tooClose = picked.some(p => {
        const pMin = parseInt(p.start.split(":")[0]) * 60 + parseInt(p.start.split(":")[1]);
        return Math.abs(startMin - pMin) < 30;
      });
      if (!tooClose) picked.push(w);
      if (picked.length === 3) break;
    }
    return picked;
  };

  const load = useCallback(async () => {
    try {
      setError(null);
      const [t0, t1] = taipeiDayRange(selectedDateOffset);
      const [y0, y1] = taipeiDayRange(selectedDateOffset - 1);
      const [w0, w1] = taipeiDayRange(selectedDateOffset - 7);

      const historicalOffsets = [-7, -14, -21, -28].map(w => selectedDateOffset + w);
      const historicalFetches = historicalOffsets.map(offset => {
        const [h0, h1] = taipeiDayRange(offset);
        return fetchRows(h0, h1);
      });

      const [selected, yesterday, weekAgo, ...historicalWeeks] = await Promise.all([
        fetchRows(t0, t1),
        fetchRows(y0, y1),
        fetchRows(w0, w1),
        ...historicalFetches,
      ]);

      setSelectedData(rowsToChartData(selected));
      setYesterdayData(rowsToChartData(yesterday));
      setWeekAgoData(rowsToChartData(weekAgo));

      const allHistorical = historicalWeeks.flat();
      setBestTimes(computeBestTimes(allHistorical));

      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedDateOffset]);

  useEffect(() => {
    load();
    if (selectedDateOffset === 0) {
      const interval = setInterval(load, REFRESH_MS);
      return () => clearInterval(interval);
    }
  }, [load, selectedDateOffset]);

  const latest     = selectedData.at(-1);
  const currentCount = latest?.count ?? null;
  const selectedPeak  = selectedData.length ? Math.max(...selectedData.map((d) => d.count)) : null;
  const selectedPeakTime = selectedData.find((d) => d.count === selectedPeak)?.time;

  let busyLabel = null;
  if (latest && yesterdayData.length) {
    const match = yesterdayData.find((d) => d.time === latest.time);
    if (match) {
      const diff = currentCount - match.count;
      if (diff > 5)       busyLabel = `▲ ${diff} more than yesterday`;
      else if (diff < -5) busyLabel = `▼ ${Math.abs(diff)} fewer than yesterday`;
      else                busyLabel = "≈ about the same as yesterday";
    }
  }

  const countColor =
    currentCount === null ? t.accent
    : currentCount > 100   ? t.countBad
    : currentCount > 80   ? t.countWarn
    : t.countGood;

  const allTimes = [...new Set([
    ...selectedData.map((d) => d.time),
    ...(showYesterday ? yesterdayData.map((d) => d.time) : []),
    ...(showWeekAgo   ? weekAgoData.map((d) => d.time)   : []),
  ])].sort();

  const yMap = Object.fromEntries(yesterdayData.map((d) => [d.time, d.count]));
  const wMap = Object.fromEntries(weekAgoData.map((d)   => [d.time, d.count]));
  const sMap = Object.fromEntries(selectedData.map((d)  => [d.time, d.count]));

  const merged = allTimes.map((time) => ({
    time,
    selected:  sMap[time] ?? null,
    yesterday: yMap[time] ?? null,
    weekAgo:   wMap[time] ?? null,
  }));

  const dateInfo = getDisplayDate(selectedDateOffset);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${t.bg}; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${t.scrollTrack}; }
        ::-webkit-scrollbar-thumb { background: ${t.scrollThumb}; border-radius: 3px; }
      `}</style>

      <div style={{
        minHeight: "100vh", background: t.bg, color: t.text,
        fontFamily: "'DM Mono', monospace", padding: "32px 28px",
        maxWidth: 960, margin: "0 auto", transition: "background 0.3s, color 0.3s",
      }}>

        {/* Header */}
        <div style={{ marginBottom: 32, borderBottom: `1px solid ${t.border}`, paddingBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <h1 style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 48,
              letterSpacing: "0.05em", color: t.title, lineHeight: 1,
            }}>NTU GYM</h1>
            <span style={{ fontSize: 20, color: t.subtitle, letterSpacing: "0.2em", textTransform: "uppercase", flex: 1 }}>
              健身中心 · Occupancy Tracker
            </span>
            <button
              onClick={() => setTheme(prev => prev === "dark" ? "light" : "dark")}
              style={{
                padding: "6px 12px", fontSize: 16, cursor: "pointer",
                background: "transparent", border: `1px solid ${t.textGhost}`,
                borderRadius: 2, color: t.textMuted, transition: "all 0.2s",
                fontFamily: "'DM Mono', monospace",
              }}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: t.subtitle, marginTop: 8 }}>
            {loading ? "Loading…"
              : lastUpdated
              ? `Last updated ${lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}${selectedDateOffset === 0 ? " · refreshes every 10 min" : ""}`
              : ""}
          </div>
        </div>

        {/* Date Navigation */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16, marginBottom: 24,
          padding: "16px", background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 2,
        }}>
          <button
            onClick={() => setSelectedDateOffset(offset => offset - 1)}
            style={{
              padding: "8px 12px", fontSize: 12, fontFamily: "'DM Mono', monospace",
              border: `1px solid ${t.textGhost}`, background: "transparent", color: t.textMuted,
              cursor: "pointer", borderRadius: 2, transition: "all 0.15s",
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = t.btnHover;
              e.currentTarget.style.color = t.btnHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = t.textGhost;
              e.currentTarget.style.color = t.textMuted;
            }}
          >
            ← Older
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: t.textMuted }}>
              Data for
            </div>
            <div style={{
              fontSize: 24, fontFamily: "'DM Mono', monospace", fontWeight: 500,
              color: t.accent, letterSpacing: "0.05em",
            }}>
              {dateInfo.display}
            </div>
            <div style={{ fontSize: 11, color: t.textMuted, letterSpacing: "0.05em" }}>
              {dateInfo.dow}
            </div>
          </div>

          <button
            onClick={() => setSelectedDateOffset(offset => offset + 1)}
            style={{
              padding: "8px 12px", fontSize: 12, fontFamily: "'DM Mono', monospace",
              border: `1px solid ${t.textGhost}`, background: "transparent", color: t.textMuted,
              cursor: "pointer", borderRadius: 2, transition: "all 0.15s",
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = t.btnHover;
              e.currentTarget.style.color = t.btnHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = t.textGhost;
              e.currentTarget.style.color = t.textMuted;
            }}
            disabled={selectedDateOffset === 0}
          >
            Newer →
          </button>
        </div>

        {error && (
          <div style={{
            background: t.errorBg, border: `1px solid ${t.errorBorder}`, borderRadius: 2,
            padding: "12px 16px", color: t.errorText, fontSize: 12, marginBottom: 24,
          }}>
            ⚠ {error} — check your Supabase URL and anon key at the top of this file.
          </div>
        )}

        {/* Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 28 }}>
          <StatCard label="Latest Reading" value={currentCount ?? "—"} sub={busyLabel} color={countColor} t={t} />
          <StatCard label="Peak Count" value={selectedPeak ?? "—"} sub={selectedPeakTime ? `at ${selectedPeakTime}` : null} color={t.accent} t={t} />
          <StatCard label="Datapoints" value={selectedData.length} sub="10-min intervals" color={t.accent} t={t} />
        </div>

        {/* Chart Controls */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: t.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", marginRight: 4 }}>Overlay</span>
          <Toggle label="Yesterday" active={showYesterday} color={t.yesterday} onClick={() => setShowYesterday((v) => !v)} t={t} />
          <Toggle label="One Week Ago" active={showWeekAgo} color={t.weekAgo} onClick={() => setShowWeekAgo((v) => !v)} t={t} />
        </div>

        {/* Line Chart */}
        <div style={{
          background: t.panelBg, border: `1px solid ${t.border}`,
          borderRadius: 2, padding: "24px 8px 16px 0",
        }}>
          {loading ? (
            <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: t.textGhost, fontSize: 13 }}>
              Fetching data…
            </div>
          ) : selectedData.length === 0 ? (
            <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: t.textGhost, fontSize: 13 }}>
              No data for {dateInfo.display} yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={merged} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.chartGrid} />
                <XAxis
                  dataKey="time" tick={{ fill: t.textDim, fontSize: 11 }}
                  tickLine={false} axisLine={{ stroke: t.chartAxis }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: t.textDim, fontSize: 11 }} tickLine={false}
                  axisLine={false} width={36}
                />
                <Tooltip content={<CustomTooltip t={t} />} />
                <Legend
                  wrapperStyle={{ paddingTop: 16, fontSize: 11, color: t.textDim, letterSpacing: "0.1em" }}
                />

                {/* Selected date */}
                <Line
                  type="monotone" dataKey="selected" name={dateInfo.display}
                  stroke={t.accent} strokeWidth={2} dot={false}
                  connectNulls activeDot={{ r: 4, fill: t.accent }}
                />

                {/* Yesterday overlay */}
                {showYesterday && (
                  <Line
                    type="monotone" dataKey="yesterday" name="Yesterday"
                    stroke={t.yesterday} strokeWidth={1.5} dot={false}
                    strokeDasharray="4 3" connectNulls
                  />
                )}

                {/* Week ago overlay */}
                {showWeekAgo && (
                  <Line
                    type="monotone" dataKey="weekAgo" name="1 Week Ago"
                    stroke={t.weekAgo} strokeWidth={1.5} dot={false}
                    strokeDasharray="4 3" connectNulls
                  />
                )}

                {/* Optimal capacity line */}
                <ReferenceLine
                  y={80} stroke={t.green} strokeDasharray="6 4" strokeWidth={1}
                  label={{ value: "Optimal (80)", fill: t.green + "44", fontSize: 10, position: "right" }}
                />

                {/* Current time marker */}
                {latest && selectedDateOffset === 0 && (
                  <ReferenceLine
                    x={latest.time} stroke={t.textGhost} strokeDasharray="2 4"
                    label={{ value: "now", fill: t.textFaint, fontSize: 10, position: "top" }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Best Time to Go */}
        {bestTimes.length > 0 && (
          <div style={{
            marginTop: 24, padding: "20px 24px",
            background: t.panelBg, border: `1px solid ${t.border}`, borderRadius: 2,
          }}>
            <div style={{
              fontSize: 11, letterSpacing: "0.15em", color: t.textMuted,
              textTransform: "uppercase", marginBottom: 16,
            }}>
              Best Time to Go · {dateInfo.dow}s <span style={{ color: t.textFaint }}>(avg of past 4 weeks)</span>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {bestTimes.map((w, i) => (
                <div key={i} style={{
                  flex: "1 1 140px", padding: "14px 18px",
                  background: i === 0 ? t.bestBg : t.cardBg,
                  border: `1px solid ${i === 0 ? t.bestBorder : t.borderLight}`,
                  borderRadius: 2,
                }}>
                  <div style={{
                    fontSize: 11, color: i === 0 ? t.green : t.textMuted,
                    letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6,
                  }}>
                    {i === 0 ? "★ Best" : `#${i + 1}`}
                  </div>
                  <div style={{
                    fontSize: 20, fontFamily: "'DM Mono', monospace",
                    color: i === 0 ? t.green : t.text, fontWeight: 500,
                  }}>
                    {w.start}–{w.end}
                  </div>
                  <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>
                    ~{w.avg} people avg
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 11, color: t.textGhost, letterSpacing: "0.05em" }}>
          Timezone: Asia/Taipei (UTC+8) · Source: rent.pe.ntu.edu.tw
        </div>
      </div>

      <Analytics />
    </>
  );
}
