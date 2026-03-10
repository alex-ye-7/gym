"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend
} from "recharts";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const REFRESH_MS = 10 * 60 * 1000; // 10 min

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

const StatCard = ({ label, value, sub, color = "#e8ff47" }) => (
  <div style={{
    background: "#111", border: "1px solid #2a2a2a", borderRadius: 2,
    padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4,
  }}>
    <span style={{ fontSize: 11, letterSpacing: "0.15em", color: "#666", textTransform: "uppercase" }}>{label}</span>
    <span style={{ fontSize: 36, fontFamily: "'DM Mono', monospace", color, fontWeight: 500, lineHeight: 1 }}>{value ?? "—"}</span>
    {sub && <span style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{sub}</span>}
  </div>
);

const Toggle = ({ label, active, color, onClick }) => (
  <button onClick={onClick} style={{
    padding: "6px 14px", fontSize: 12, letterSpacing: "0.1em",
    textTransform: "uppercase", fontFamily: "'DM Mono', monospace",
    border: `1px solid ${active ? color : "#333"}`,
    background: active ? color + "18" : "transparent",
    color: active ? color : "#555",
    borderRadius: 2, cursor: "pointer", transition: "all 0.15s",
  }}>{label}</button>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#0d0d0d", border: "1px solid #2a2a2a",
      padding: "10px 14px", borderRadius: 2,
    }}>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 6, letterSpacing: "0.1em" }}>{label}</div>
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
  const [selectedDateOffset, setSelectedDateOffset] = useState(0); // 0 = today, -1 = yesterday, etc.
  const [selectedData,      setSelectedData]      = useState([]);
  const [yesterdayData,     setYesterdayData]     = useState([]);
  const [weekAgoData,       setWeekAgoData]       = useState([]);
  const [showYesterday,     setShowYesterday]     = useState(false);
  const [showWeekAgo,       setShowWeekAgo]       = useState(false);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState(null);
  const [lastUpdated,       setLastUpdated]       = useState(null);

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

  const load = useCallback(async () => {
    try {
      setError(null);
      const [t0, t1] = taipeiDayRange(selectedDateOffset);
      const [y0, y1] = taipeiDayRange(selectedDateOffset - 1);
      const [w0, w1] = taipeiDayRange(selectedDateOffset - 7);

      const [selected, yesterday, weekAgo] = await Promise.all([
        fetchRows(t0, t1),
        fetchRows(y0, y1),
        fetchRows(w0, w1),
      ]);

      setSelectedData(rowsToChartData(selected));
      setYesterdayData(rowsToChartData(yesterday));
      setWeekAgoData(rowsToChartData(weekAgo));
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedDateOffset]);

  useEffect(() => {
    load();
    // Only auto-refresh if showing today's data
    if (selectedDateOffset === 0) {
      const interval = setInterval(load, REFRESH_MS);
      return () => clearInterval(interval);
    }
  }, [load, selectedDateOffset]);

  const latest     = selectedData.at(-1);
  const currentCount = latest?.count ?? null;
  const selectedPeak  = selectedData.length ? Math.max(...selectedData.map((d) => d.count)) : null;
  const selectedPeakTime = selectedData.find((d) => d.count === selectedPeak)?.time;

  // Busy-ness: compare current count vs yesterday same time
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

  // Color by occupancy
  const countColor =
    currentCount === null ? "#e8ff47"
    : currentCount > 100   ? "#ff4f4f"
    : currentCount > 80   ? "#ffaa00"
    : "#4fffb0";

  // Merge selected + overlays into a unified time-keyed dataset
  const allTimes = [...new Set([
    ...selectedData.map((d) => d.time),
    ...(showYesterday ? yesterdayData.map((d) => d.time) : []),
    ...(showWeekAgo   ? weekAgoData.map((d) => d.time)   : []),
  ])].sort();

  const yMap = Object.fromEntries(yesterdayData.map((d) => [d.time, d.count]));
  const wMap = Object.fromEntries(weekAgoData.map((d)   => [d.time, d.count]));
  const sMap = Object.fromEntries(selectedData.map((d)  => [d.time, d.count]));

  const merged = allTimes.map((t) => ({
    time: t,
    selected:  sMap[t] ?? null,
    yesterday: yMap[t] ?? null,
    weekAgo:   wMap[t] ?? null,
  }));

  const dateInfo = getDisplayDate(selectedDateOffset);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0a; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
      `}</style>

      <div style={{
        minHeight: "100vh", background: "#0a0a0a", color: "#e0e0e0",
        fontFamily: "'DM Mono', monospace", padding: "32px 28px",
        maxWidth: 960, margin: "0 auto",
      }}>

        {/* Header */}
        <div style={{ marginBottom: 32, borderBottom: "1px solid #1e1e1e", paddingBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <h1 style={{
              fontFamily: "'Bebas Neue', sans-serif", fontSize: 48,
              letterSpacing: "0.05em", color: "#fff", lineHeight: 1,
            }}>NTU GYM</h1>
            <span style={{ fontSize: 20, color: "#fff", letterSpacing: "0.2em", textTransform: "uppercase" }}>
              健身中心 · Occupancy Tracker
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#fff", marginTop: 8 }}>
            {loading ? "Loading…"
              : lastUpdated
              ? `Last updated ${lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}${selectedDateOffset === 0 ? " · auto-refreshes every 10 min" : ""}`
              : ""}
          </div>
        </div>

        {/* Date Navigation */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16, marginBottom: 24,
          padding: "16px", background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 2,
        }}>
          <button
            onClick={() => setSelectedDateOffset(offset => offset + 1)}
            style={{
              padding: "8px 12px", fontSize: 12, fontFamily: "'DM Mono', monospace",
              border: "1px solid #333", background: "transparent", color: "#999",
              cursor: "pointer", borderRadius: 2, transition: "all 0.15s",
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#e8ff47";
              e.currentTarget.style.color = "#e8ff47";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#333";
              e.currentTarget.style.color = "#999";
            }}
            disabled={selectedDateOffset === 0}
          >
            ← Newer
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <div style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "#666" }}>
              Data for
            </div>
            <div style={{
              fontSize: 24, fontFamily: "'DM Mono', monospace", fontWeight: 500,
              color: "#e8ff47", letterSpacing: "0.05em",
            }}>
              {dateInfo.display}
            </div>
            <div style={{ fontSize: 11, color: "#999", letterSpacing: "0.05em" }}>
              {dateInfo.dow}
            </div>
          </div>

          <button
            onClick={() => setSelectedDateOffset(offset => offset - 1)}
            style={{
              padding: "8px 12px", fontSize: 12, fontFamily: "'DM Mono', monospace",
              border: "1px solid #333", background: "transparent", color: "#999",
              cursor: "pointer", borderRadius: 2, transition: "all 0.15s",
              fontWeight: 600,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#e8ff47";
              e.currentTarget.style.color = "#e8ff47";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#333";
              e.currentTarget.style.color = "#999";
            }}
          >
            Older →
          </button>
        </div>

        {error && (
          <div style={{
            background: "#1a0000", border: "1px solid #550000", borderRadius: 2,
            padding: "12px 16px", color: "#ff6b6b", fontSize: 12, marginBottom: 24,
          }}>
            ⚠ {error} — check your Supabase URL and anon key at the top of this file.
          </div>
        )}

        {/* Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 28 }}>
          <StatCard label="Latest Reading" value={currentCount ?? "—"} sub={busyLabel} color={countColor} />
          <StatCard label="Peak Count" value={selectedPeak ?? "—"} sub={selectedPeakTime ? `at ${selectedPeakTime}` : null} color="#e8ff47" />
          <StatCard label="Datapoints" value={selectedData.length} sub="10-min intervals" color="#e8ff47" />
        </div>

        {/* Chart Controls */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#444", letterSpacing: "0.1em", textTransform: "uppercase", marginRight: 4 }}>Overlay</span>
          <Toggle label="Yesterday" active={showYesterday} color="#7eb8ff" onClick={() => setShowYesterday((v) => !v)} />
          <Toggle label="One Week Ago" active={showWeekAgo} color="#b97eff" onClick={() => setShowWeekAgo((v) => !v)} />
        </div>

        {/* Line Chart */}
        <div style={{
          background: "#0e0e0e", border: "1px solid #1e1e1e",
          borderRadius: 2, padding: "24px 8px 16px 0",
        }}>
          {loading ? (
            <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13 }}>
              Fetching data…
            </div>
          ) : selectedData.length === 0 ? (
            <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13 }}>
              No data for {dateInfo.display} yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={merged} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis
                  dataKey="time" tick={{ fill: "#555", fontSize: 11 }}
                  tickLine={false} axisLine={{ stroke: "#222" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#555", fontSize: 11 }} tickLine={false}
                  axisLine={false} width={36}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: 16, fontSize: 11, color: "#555", letterSpacing: "0.1em" }}
                />

                {/* Selected date */}
                <Line
                  type="monotone" dataKey="selected" name={dateInfo.display}
                  stroke="#e8ff47" strokeWidth={2} dot={false}
                  connectNulls activeDot={{ r: 4, fill: "#e8ff47" }}
                />

                {/* Yesterday overlay */}
                {showYesterday && (
                  <Line
                    type="monotone" dataKey="yesterday" name="Yesterday"
                    stroke="#7eb8ff" strokeWidth={1.5} dot={false}
                    strokeDasharray="4 3" connectNulls
                  />
                )}

                {/* Week ago overlay */}
                {showWeekAgo && (
                  <Line
                    type="monotone" dataKey="weekAgo" name="1 Week Ago"
                    stroke="#b97eff" strokeWidth={1.5} dot={false}
                    strokeDasharray="4 3" connectNulls
                  />
                )}

                {/* Current time marker */}
                {latest && selectedDateOffset === 0 && (
                  <ReferenceLine
                    x={latest.time} stroke="#333" strokeDasharray="2 4"
                    label={{ value: "now", fill: "#444", fontSize: 10, position: "top" }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ marginTop: 20, fontSize: 11, color: "#333", letterSpacing: "0.05em" }}>
          Timezone: Asia/Taipei (UTC+8) · Source: rent.pe.ntu.edu.tw
        </div>
      </div>
    </>
  );
}
