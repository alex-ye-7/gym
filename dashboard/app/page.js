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
const toTaipei = (utcStr) => {
  const d = new Date(utcStr);
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
  const [todayData,     setTodayData]     = useState([]);
  const [yesterdayData, setYesterdayData] = useState([]);
  const [weekAgoData,   setWeekAgoData]   = useState([]);
  const [showYesterday, setShowYesterday] = useState(false);
  const [showWeekAgo,   setShowWeekAgo]   = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [lastUpdated,   setLastUpdated]   = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [t0, t1] = taipeiDayRange(0);
      const [y0, y1] = taipeiDayRange(-1);
      const [w0, w1] = taipeiDayRange(-7);

      const [today, yesterday, weekAgo] = await Promise.all([
        fetchRows(t0, t1),
        fetchRows(y0, y1),
        fetchRows(w0, w1),
      ]);

      setTodayData(rowsToChartData(today));
      setYesterdayData(rowsToChartData(yesterday));
      setWeekAgoData(rowsToChartData(weekAgo));
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  const latest     = todayData.at(-1);
  const currentCount = latest?.count ?? null;
  const todayPeak  = todayData.length ? Math.max(...todayData.map((d) => d.count)) : null;
  const todayPeakTime = todayData.find((d) => d.count === todayPeak)?.time;

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
    : currentCount > 80   ? "#ff4f4f"
    : currentCount > 50   ? "#ffaa00"
    : "#4fffb0";

  // Merge today + overlays into a unified time-keyed dataset
  const allTimes = [...new Set([
    ...todayData.map((d) => d.time),
    ...(showYesterday ? yesterdayData.map((d) => d.time) : []),
    ...(showWeekAgo   ? weekAgoData.map((d) => d.time)   : []),
  ])].sort();

  const yMap = Object.fromEntries(yesterdayData.map((d) => [d.time, d.count]));
  const wMap = Object.fromEntries(weekAgoData.map((d)   => [d.time, d.count]));
  const tMap = Object.fromEntries(todayData.map((d)     => [d.time, d.count]));

  const merged = allTimes.map((t) => ({
    time: t,
    today:     tMap[t] ?? null,
    yesterday: yMap[t] ?? null,
    weekAgo:   wMap[t] ?? null,
  }));

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
              ? `Last updated ${lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} · auto-refreshes every 10 min`
              : ""}
          </div>
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
          <StatCard label="Right Now" value={currentCount ?? "—"} sub={busyLabel} color={countColor} />
          <StatCard label="Today's Peak" value={todayPeak ?? "—"} sub={todayPeakTime ? `at ${todayPeakTime}` : null} color="#e8ff47" />
          <StatCard label="Datapoints Today" value={todayData.length} sub="10-min intervals" color="#e8ff47" />
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
          ) : todayData.length === 0 ? (
            <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13 }}>
              No data for today yet.
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

                {/* Today */}
                <Line
                  type="monotone" dataKey="today" name="Today"
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
                {latest && (
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
