import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ===================== Utils =====================
const tz = "Asia/Tokyo";
const ENDPOINT_STORAGE = "/.netlify/functions/storage";
const ENDPOINT_LIST = "/.netlify/functions/listDates";
const LS_PREFIX = "aec:v4.3:";

const idle = (fn) => (("requestIdleCallback" in window) ? window.requestIdleCallback(fn) : setTimeout(fn, 0));
function todayISO(d = new Date()) {
  const z = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .replaceAll("/", "-");
  return z;
}
const DAY_GENRE = {
  0: "Seasonal（季節・イベント・行事）",
  1: "HR（採用・育成）",
  2: "Compliance（勤怠・制度）",
  3: "HQ（本国報告・ドキュメント作成）",
  4: "Sales（接客・営業・販売スキル）",
  5: "Small Talk（雑談・会食）",
  6: "Writing（書き言葉・メール・案内）",
};
const DEFAULT_PIN = "1202"; // Functions側でTRAINER_PIN検証

const BTN_SOLID_GRAY =
  "inline-flex items-center justify-center rounded-xl px-3 py-1 text-sm font-medium text-white bg-gray-700 " +
  "active:scale-[0.98] transition-transform disabled:opacity-50 disabled:pointer-events-none";

// ===================== Cloud I/O =====================
async function cloudLoad({ userId, dateISO }) {
  const url = `${ENDPOINT_STORAGE}?user=${encodeURIComponent(userId)}&date=${dateISO}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  return res.json();
}
async function cloudSave({ userId, dateISO, data, asTrainer = false, pin = "" }) {
  const res = await fetch(ENDPOINT_STORAGE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: userId, date: dateISO, data, asTrainer, pin }) });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  return res.json();
}
async function cloudListDates({ userId }) {
  const url = `${ENDPOINT_LIST}?user=${encodeURIComponent(userId)}`;
  const res = await fetch(url);
  if (!res.ok) return { dates: [] };
  return res.json();
}

// ===================== Input (IME-safe, iOS-stable, autosize) =====================
const DebouncedInput = React.memo(function DebouncedInput({
  value,
  onChange,
  className = "",
  placeholder = "",
  multiline = false,
  rows = 1,
  debounceMs = 220,
  autoGrow = true,
}) {
  const [inner, setInner] = useState(value ?? "");
  const compRef = useRef(false); // IME合成中
  const tRef = useRef(null);
  const elRef = useRef(null);

  // 親->子 同期（フォーカス中は上書きしない）
  useEffect(() => {
    if (compRef.current) return;
    if (document.activeElement === elRef.current) return;
    setInner(value ?? "");
  }, [value]);

  const flush = useCallback((next) => {
    if (typeof onChange !== "function") return;
    if (next === value) return;
    onChange(next);
  }, [onChange, value]);

  const schedule = useCallback((next) => {
    if (compRef.current) return;
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => flush(next), debounceMs);
  }, [flush, debounceMs]);

  const resize = useCallback(() => {
    if (!autoGrow || !multiline || !elRef.current) return;
    const el = elRef.current;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
  }, [autoGrow, multiline]);
  useEffect(() => { resize(); }, [inner, resize]);

  const common = {
    ref: elRef,
    className,
    placeholder,
    value: inner,
    onChange: (e) => { const v = e.target.value; setInner(v); schedule(v); },
    onBlur: () => flush(inner),
    onCompositionStart: () => { compRef.current = true; },
    onCompositionEnd: (e) => { compRef.current = false; const v = e.currentTarget.value; setInner(v); flush(v); },
    autoComplete: 'off', autoCorrect: 'off', spellCheck: false,
    inputMode: 'text'
  };
  if (!multiline) return <input {...common} />;
  return <textarea {...common} rows={rows} style={{resize:'none', overflow:'hidden'}} />;
});

// ===================== Calendar helpers =====================
function listLocalDatesForUser(userId) {
  const prefix = `${LS_PREFIX}${userId}:`;
  const dates = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || "";
    if (k.startsWith(prefix)) {
      const d = k.substring(prefix.length, prefix.length + 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
    }
  }
  return dates;
}
function MonthCalendar({ dateISO, onSelect, marked }) {
  const d = new Date(`${dateISO}T00:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return (
    <div className="card" style={{padding:'12px', background:'white'}}>
      <div className="flex items-center justify-between mb-2" style={{display:'flex', justifyContent:'space-between', marginBottom:8}}>
        <button className="btn" onClick={() => onSelect(todayISO(new Date(y, m - 1, 1)))}>◀</button>
        <div className="text-sm font-medium">{y}年{String(m + 1).padStart(2, "0")}月</div>
        <button className="btn" onClick={() => onSelect(todayISO(new Date(y, m + 1, 1)))}>▶</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-gray-500 mb-1" style={{display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:4, textAlign:'center', fontSize:11, color:'#6b7280', marginBottom:4}}>{"月火水木金土日".split("").map(w => <div key={w}>{w}</div>)}</div>
      <div className="grid grid-cols-7 gap-1" style={{display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:4}}>
        {days.map(dt => {
          const iso = todayISO(dt);
          const inMonth = dt.getMonth() === m;
          const selected = iso === dateISO;
          const has = marked.has(iso);
          return (
            <button key={iso} onClick={() => onSelect(iso)}
              className="btn"
              style={{height:36, borderRadius:12, position:'relative', background:selected?'black':'white', color:selected?'white':'#111827', opacity: inMonth ? 1 : .45}}>
              {String(dt.getDate())}
              {has && <span style={{position:'absolute', bottom:6, width:6, height:6, borderRadius:9999, background:selected?'white':'black'}} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===================== Data Model =====================
const defaultWorksheet = (dateISO) => ({
  meta: {
    app: "annetmii-english-camp",
    version: 43,
    date: dateISO,
    genre: DAY_GENRE[new Date(dateISO + "T00:00:00").getDay()],
    trainee: "Masayuki",
    theme: "",
  },
  parts: {
    part1: {
      label: "Part 1｜語彙チェック（英単語→日本語訳）",
      instructions: "英単語の日本語訳を入力してください。",
      items: [
        { id: crypto.randomUUID(), en: "warning" },
        { id: crypto.randomUUID(), en: "shelter" },
        { id: crypto.randomUUID(), en: "evacuate" },
        { id: crypto.randomUUID(), en: "calm" },
        { id: crypto.randomUUID(), en: "debris" },
        { id: crypto.randomUUID(), en: "inspect" },
        { id: crypto.randomUUID(), en: "help" },
        { id: crypto.randomUUID(), en: "take cover" },
      ],
      answers: {},
      trainerNotes: "",
    },
    part2: {
      label: "Part 2｜構文トレーニング（穴埋め＋日本語訳）",
      instructions: "Part1の語彙を使って文を完成させ、日本語訳も入力してください。",
      items: [
        { id: crypto.randomUUID(), prompt: "We need to follow the ______ from the radio." },
        { id: crypto.randomUUID(), prompt: "Please stay ______ until we know it’s safe." },
        { id: crypto.randomUUID(), prompt: "Let’s ______ the area before it’s too dangerous." },
        { id: crypto.randomUUID(), prompt: "The city sent volunteers to ______ the elderly." },
        { id: crypto.randomUUID(), prompt: "After the storm, we need to ______ the power lines." },
      ],
      answers: {},
      trainerNotes: "",
    },
    part3: {
      label: "Part 3｜会話ロールプレイ",
      instructions: "英文を入力して会話を完成させてください。",
      items: [
        { id: crypto.randomUUID(), otherRole: "Coworker", otherEn: "Hey Masayuki, did you hear they issued a tsunami warning?", jp: "はい。日々の訓練通り、落ち着いて速やかに行動しましょう。" },
        { id: crypto.randomUUID(), otherRole: "Coworker", otherEn: "Please stay calm and follow the official instructions.", jp: "まずは警告を確認して指示に従いましょう。" },
        { id: crypto.randomUUID(), otherRole: "Coworker", otherEn: "Shall we evacuate to higher ground now?", jp: "はい。急いで準備をして高台に行きましょう。" },
        { id: crypto.randomUUID(), otherRole: "Coworker", otherEn: "Do you need any help with your bag?", jp: "いいえ。一緒に安全を確保しましょう。" },
      ],
      answers: {},
      trainerNotes: "",
    },
    part4: { label: "Part 4｜英作文", instructions: "本日のテーマに沿って80–120語で英作文を作ろう。iPadは手書きも可（PNG保存）。", answer: "", handwriting: null, trainerNotes: "" },
  },
  trainerFeedback: "",
  submittedAt: null,
});

// ===================== Header (fixed) =====================
const Header = React.memo(function Header({
  genre,
  dateISO,
  status,
  mode,
  pinInput,
  onPinChange,
  switchToTrainer,
  switchToStudent,
  showCal,
  setShowCal,
  doSync,
  submit,
  userId,
  markedDates,
  onPickDate
}) {
  return (
    <header className="sticky-header">
      {/* 1段目：ロゴ／モードスイッチ */}
      <div
        className="container"
        style={{
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img
            src="/logo.png"
            alt="annetmii"
            style={{ height: 24 }}
            onError={(e) => {
              const s = document.createElement("span");
              s.textContent = "annetmii";
              e.currentTarget.replaceWith(s);
            }}
          />
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
            English Camp
          </h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="btn"
            onClick={(ev) => {
              ev.stopPropagation();
              setShowCal((v) => !v);
            }}
          >
            カレンダー
          </button>

          {mode === "student" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* PINは4桁幅、数字のみ */}
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="input pin-4ch"
                placeholder="PIN"
                value={pinInput}
                onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ""))}
              />
              <button
                className="btn-solid-gray"
                onClick={(ev) => {
                  ev.stopPropagation();
                  switchToTrainer();
                }}
              >
                講師モード
              </button>
            </div>
          ) : (
            <button
              className="btn"
              onClick={(ev) => {
                ev.stopPropagation();
                switchToStudent();
              }}
            >
              学習者モードへ
            </button>
          )}
        </div>
      </div>

      {/* 2段目：日付／同期・提出 */}
      <div
        className="container"
        style={{
          padding: "0 16px 8px",
          display: "flex",
          justifyContent: "space-between",
          color: "#6b7280",
          fontSize: 11,
        }}
      >
        <span>
          {genre}｜{dateISO}
        </span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            className="btn-solid-gray"
            onClick={(e) => {
              e.stopPropagation();
              doSync("手動同期");
            }}
          >
            同期
          </button>
          <button
            className="btn-solid-gray"
            onClick={(e) => {
              e.stopPropagation();
              submit();
            }}
          >
            提出
          </button>
          <span>状態：{status}</span>
        </div>
      </div>

      {/* 3段目：カレンダー（必要時のみ） */}
      {showCal ? (
        <div
          className="container"
          style={{ padding: "0 16px 12px" }}
          onClick={(e) => e.stopPropagation()}
        >
          <MonthCalendar
            dateISO={dateISO}
            onSelect={(iso) => {
              onPickDate(iso);
            }}
            marked={markedDates}
          />
        </div>
      ) : null}
    </header>
  );
});

// ===================== App =====================
export default function App() {
  const [userId] = useState("masayuki");
  const [dateISO, setDateISO] = useState(todayISO());
  const [mode, setMode] = useState("student");
  const [pinInput, setPinInput] = useState("");
  const [status, setStatus] = useState("準備完了");
  const [showCal, setShowCal] = useState(false);
  const [cloudDates, setCloudDates] = useState(new Set());

  // worksheet state
  const [ws, setWs] = useState(() => {
    const ls = localStorage.getItem(`${LS_PREFIX}${userId}:${todayISO()}`);
    return ls ? JSON.parse(ls) : defaultWorksheet(todayISO());
  });

  // genre
  const genre = useMemo(() => DAY_GENRE[new Date(`${dateISO}T00:00:00`).getDay()], [dateISO]);

  // expose setter for header calendar selection
  useEffect(() => { window.__aec_setDate = (iso) => setDateISO(iso); return () => { delete window.__aec_setDate; }; }, []);

  // localStorage save (batched 500ms + idle)
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => idle(() => {
      try { localStorage.setItem(`${LS_PREFIX}${userId}:${ws.meta.date}`, JSON.stringify(ws)); } catch {}
    }), 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [ws, userId]);

  // load cloud on start/date change
  useEffect(() => {
    (async () => {
      try {
        setStatus("クラウド読込中…");
        const remote = await cloudLoad({ userId, dateISO });
        if (remote && remote.data) { setWs(remote.data); setStatus("クラウドから読み込みました"); }
        else { setWs((cur) => (cur?.meta?.date === dateISO ? cur : defaultWorksheet(dateISO))); setStatus("本日のワークシートを作成しました"); }
      } catch { setStatus("オフライン：ローカル保存のみ"); }
    })();
  }, [userId, dateISO]);

  // fetch cloud dates (for ◎ marking)
  const refreshCloudDates = useCallback(async () => {
    try {
      const res = await cloudListDates({ userId });
      setCloudDates(new Set(res.dates || []));
    } catch {}
  }, [userId]);
  useEffect(() => { refreshCloudDates(); }, [refreshCloudDates]);

  const markedDates = useMemo(() => {
    const set = new Set(listLocalDatesForUser(userId));
    cloudDates.forEach(d => set.add(d));
    return set;
  }, [userId, cloudDates]);

  // ============= Input batching for Parts answers =============
  const draftRef = useRef({ p1: {}, p2: {}, p3: {} });
  const flushTimerRef = useRef(null);
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      const d = draftRef.current; draftRef.current = { p1: {}, p2: {}, p3: {} };
      if (Object.keys(d.p1).length || Object.keys(d.p2).length || Object.keys(d.p3).length) {
        setWs((cur) => {
          const next = { ...cur, parts: { ...cur.parts } };
          if (Object.keys(d.p1).length) next.parts.part1 = { ...cur.parts.part1, answers: { ...cur.parts.part1.answers, ...d.p1 } };
          if (Object.keys(d.p2).length) next.parts.part2 = { ...cur.parts.part2, answers: { ...cur.parts.part2.answers, ...d.p2 } };
          if (Object.keys(d.p3).length) next.parts.part3 = { ...cur.parts.part3, answers: { ...cur.parts.part3.answers, ...d.p3 } };
          return next;
        });
      }
      clearTimeout(flushTimerRef.current); flushTimerRef.current = null;
    }, 300);
  }, []);

  // ============= Cloud auto-sync =============
  const lastChangeRef = useRef(Date.now());
  useEffect(() => { lastChangeRef.current = Date.now(); }, [ws]); // update timestamp on any ws change

  useEffect(() => {
    const id = setInterval(async () => {
      const idleFor = Date.now() - lastChangeRef.current;
      if (idleFor >= 60000) { // 60s idle
        try {
          setStatus("自動同期中…");
          await cloudSave({ userId, dateISO, data: ws, asTrainer: mode === "trainer", pin: mode === "trainer" ? pinInput : "" });
          setStatus("自動同期完了");
          refreshCloudDates();
        } catch {
          setStatus("自動同期失敗：後で再試行");
        }
        lastChangeRef.current = Date.now(); // reset
      }
    }, 5000); // check every 5s
    return () => clearInterval(id);
  }, [userId, dateISO, ws, mode, pinInput, refreshCloudDates]);

  const doSync = useCallback(async (reason = "同期") => {
    try { setStatus(`${reason}中…`);
      await cloudSave({ userId, dateISO, data: ws, asTrainer: mode === "trainer", pin: mode === "trainer" ? pinInput : "" });
      setStatus(`${reason}完了`);
      refreshCloudDates();
    } catch { setStatus(`${reason}失敗：後で再試行`); }
  }, [userId, dateISO, ws, mode, pinInput, refreshCloudDates]);

  const submit = useCallback(() => { setWs((c) => ({ ...c, submittedAt: new Date().toISOString() })); doSync("提出"); }, [doSync]);
  const switchToTrainer = useCallback(() => { if (pinInput === DEFAULT_PIN) { setMode("trainer"); } else { alert("PINが違います。"); } }, [pinInput]);
  const switchToStudent = useCallback(() => setMode("student"), []);

  // ===================== UI Shell =====================
  const Card = ({ title, children, instructions }) => (
    <section className="container" style={{padding:'12px 16px'}}>
      <div className="card">
        <div style={{padding:'12px 16px', borderBottom:'1px solid #e5e7eb'}}>
          <h2 style={{fontSize:16, fontWeight:600, margin:'0 0 4px'}}>{title}</h2>
          {instructions ? <div className="label" style={{lineHeight:1.6}}>{instructions}</div> : null}
        </div>
        <div style={{padding:'16px'}}>{children}</div>
      </div>
    </section>
  );

  const ThemeBar = React.memo(() => (
    <Card title="本日のテーマ">
      <DebouncedInput multiline rows={2} autoGrow className="input fullwide" placeholder="Week 4｜Tuesday（Emergency）- 緊急事態に備えよう　Picture Dictionaryの「Emergency Procedures」（p.147）から学びましょう" value={ws.meta.theme} onChange={(v) => setWs((cur) => ({ ...cur, meta: { ...cur.meta, theme: v } }))} />
    </Card>
  ));

  // Part1 Row
  const Part1Row = React.memo(function Part1Row({ it, idx }) {
    const answer = ws.parts.part1.answers[it.id] ?? "";
    const onChangeWord = (v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, items: cur.parts.part1.items.map((x) => (x.id === it.id ? { ...x, en: v } : x)) } } }));
    const onChangeAnswer = (v) => { draftRef.current.p1[it.id] = v; scheduleFlush(); };
    const onRemove = () => setWs((cur) => { const items = cur.parts.part1.items.filter((x) => x.id !== it.id); const answers = { ...cur.parts.part1.answers }; delete answers[it.id]; return { ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, items, answers } } }; });
    return (
      <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:8}}>
        <span className="label" style={{width:24}}>{idx + 1}.</span>
        {mode === "trainer" ? (
          <DebouncedInput className="input" style={{width:120}} value={it.en} onChange={onChangeWord} />
        ) : (
          <span style={{fontWeight:600, minWidth:88}}>{it.en}</span>
        )}
        <DebouncedInput className="input" style={{flex:1}} placeholder="日本語訳" value={answer} onChange={onChangeAnswer} />
        {mode === "trainer" && (
          <button className="btn" onClick={onRemove} style={{color:'#ef4444'}}>削除</button>
        )}
      </div>
    );
  });

  const Part1 = React.memo(() => (
    <Card title={ws.parts.part1.label} instructions={ws.parts.part1.instructions}>
      <div style={{display:'grid', gridTemplateColumns:'1fr', gap:12}}>
        {ws.parts.part1.items.map((it, idx) => (
          <Part1Row key={it.id} it={it} idx={idx} />
        ))}
      </div>
      {mode === "trainer" && (
        <div style={{paddingTop:8, display:'flex', gap:8}}>
          <button className="btn btn-primary" onClick={() => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, items: [...cur.parts.part1.items, { id: crypto.randomUUID(), en: "new word" }] } } }))}>語彙を追加</button>
        </div>
      )}
      {/* Trainer notes for Part1 */}
      {mode === "trainer" ? (
        <div style={{marginTop:12}}>
          <div className="label">講師コメント</div>
          <DebouncedInput multiline rows={3} autoGrow className="input" value={ws.parts.part1.trainerNotes} onChange={(v) => setWs(cur => ({ ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, trainerNotes: v } } }))} />
        </div>
      ) : (ws.parts.part1.trainerNotes ? (
        <div style={{marginTop:12, background:'#f9fafb', borderLeft:'4px solid #e5e7eb', padding:'8px 12px', borderRadius:8}}>
          <strong>講師コメント：</strong><br/>{ws.parts.part1.trainerNotes}
        </div>
      ) : null)}
    </Card>
  ));

  const Part2 = React.memo(() => (
    <Card title={ws.parts.part2.label} instructions={ws.parts.part2.instructions}>
      {ws.parts.part2.items.map((it, idx) => {
        const ans = ws.parts.part2.answers[it.id] || { en: "", ja: "" };
        return (
          <div key={it.id} style={{marginBottom:12}}>
            <div style={{display:'flex', gap:8, alignItems:'flex-start'}}>
              <span className="label" style={{width:24}}>{idx + 1}.</span>
              {mode === "trainer" ? (
                <DebouncedInput className="input" style={{flex:1}} value={it.prompt} onChange={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part2: { ...cur.parts.part2, items: cur.parts.part2.items.map((x) => (x.id === it.id ? { ...x, prompt: v } : x)) } } }))} />
              ) : (
                <p style={{margin:0, lineHeight:1.6, flex:1}}>{it.prompt}</p>
              )}
            </div>
            <div style={{paddingLeft:32, display:'grid', gridTemplateColumns:'1fr', gap:8, marginTop:8}}>
              <DebouncedInput className="input" placeholder="英語の答え（穴埋め）" value={ans.en} onChange={(v) => { draftRef.current.p2[it.id] = { ...(draftRef.current.p2[it.id] || ans), en: v }; scheduleFlush(); }} />
              <DebouncedInput className="input" placeholder="日本語訳" value={ans.ja} onChange={(v) => { draftRef.current.p2[it.id] = { ...(draftRef.current.p2[it.id] || ans), ja: v }; scheduleFlush(); }} />
            </div>
          </div>
        );
      })}
      {/* Trainer notes for Part2 */}
      {mode === "trainer" ? (
        <div style={{marginTop:12}}>
          <div className="label">講師コメント</div>
          <DebouncedInput multiline rows={3} autoGrow className="input" value={ws.parts.part2.trainerNotes} onChange={(v) => setWs(cur => ({ ...cur, parts: { ...cur.parts, part2: { ...cur.parts.part2, trainerNotes: v } } }))} />
        </div>
      ) : (ws.parts.part2.trainerNotes ? (
        <div style={{marginTop:12, background:'#f9fafb', borderLeft:'4px solid #e5e7eb', padding:'8px 12px', borderRadius:8}}>
          <strong>講師コメント：</strong><br/>{ws.parts.part2.trainerNotes}
        </div>
      ) : null)}
    </Card>
  ));

  const Part3 = React.memo(() => (
    <Card title={ws.parts.part3.label} instructions={ws.parts.part3.instructions}>
      {ws.parts.part3.items.map((it, idx) => (
        <div key={it.id} style={{marginBottom:12}}>
          <div style={{display:'flex', gap:8, alignItems:'flex-start'}}>
            <span className="label" style={{width:24}}>{idx + 1}.</span>
            <div style={{flex:1}}>
              {mode === "trainer" ? (
                <DebouncedInput className="input" style={{width:160, marginBottom:6}} value={it.otherRole || ""} placeholder="相手役の名前（例：Coworker）" onChange={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: cur.parts.part3.items.map((x) => (x.id === it.id ? { ...x, otherRole: v } : x)) } } }))} />
              ) : (it.otherRole ? <div className="label" style={{marginBottom:6}}>{it.otherRole}</div> : null)}
              {mode === "trainer" ? (
                <DebouncedInput className="input" placeholder="相手の英語セリフ" value={it.otherEn} onChange={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: cur.parts.part3.items.map((x) => (x.id === it.id ? { ...x, otherEn: v } : x)) } } }))} />
              ) : (
                <p style={{margin:0, lineHeight:1.6}}>{it.otherEn}</p>
              )}
            </div>
          </div>
          <div style={{paddingLeft:32, marginTop:8}}>
            <div className="label">Masayuki</div>
            <DebouncedInput multiline rows={2} autoGrow className="input fullwide" placeholder="英語：ここに英訳を入力" value={ws.parts.part3.answers[it.id] ?? ""} onChange={(v) => { draftRef.current.p3[it.id] = v; scheduleFlush(); }} />
            <div className="label" style={{marginTop:8}}>日本語</div>
            {mode === "trainer" ? (
              <DebouncedInput multiline rows={2} autoGrow className="input" value={it.jp} onChange={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: cur.parts.part3.items.map((x) => (x.id === it.id ? { ...x, jp: v } : x)) } } }))} />
            ) : (
              <p style={{margin:0, lineHeight:1.6}}>{it.jp}</p>
            )}
          </div>
        </div>
      ))}
      {mode === "trainer" && (
        <div style={{paddingTop:8, display:'flex', gap:8}}>
          <button className="btn btn-primary" onClick={() => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: [...cur.parts.part3.items, { id: crypto.randomUUID(), otherRole: "", otherEn: "", jp: "" }] } } }))}>セリフを追加</button>
        </div>
      )}
      {/* Trainer notes for Part3 */}
      {mode === "trainer" ? (
        <div style={{marginTop:12}}>
          <div className="label">講師コメント</div>
          <DebouncedInput multiline rows={3} autoGrow className="input" value={ws.parts.part3.trainerNotes} onChange={(v) => setWs(cur => ({ ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, trainerNotes: v } } }))} />
        </div>
      ) : (ws.parts.part3.trainerNotes ? (
        <div style={{marginTop:12, background:'#f9fafb', borderLeft:'4px solid #e5e7eb', padding:'8px 12px', borderRadius:8}}>
          <strong>講師コメント：</strong><br/>{ws.parts.part3.trainerNotes}
        </div>
      ) : null)}
    </Card>
  ));

  // Part4 (handwriting)
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return; const ctx = canvas.getContext("2d"); let drawing = false;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); const t = e.touches && e.touches[0]; const x = (t ? t.clientX : e.clientX) - r.left; const y = (t ? t.clientY : e.clientY) - r.top; return { x, y }; };
    const start = (e) => { drawing = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const move = (e) => { if (!drawing) return; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
    const end = () => { drawing = false; };
    canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); canvas.addEventListener("mouseup", end); canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("touchstart", start, { passive: true }); canvas.addEventListener("touchmove", move, { passive: true }); canvas.addEventListener("touchend", end);
    return () => { canvas.removeEventListener("mousedown", start); canvas.removeEventListener("mousemove", move); canvas.removeEventListener("mouseup", end); canvas.removeEventListener("mouseleave", end); canvas.removeEventListener("touchstart", start); canvas.removeEventListener("touchmove", move); canvas.removeEventListener("touchend", end); };
  }, []);

  const Part4 = React.memo(() => (
    <Card title={ws.parts.part4.label} instructions={ws.parts.part4.instructions}>
      <DebouncedInput multiline rows={3} autoGrow className="input fullwide" placeholder="ここに英作文を入力してください" value={ws.parts.part4.answer} onChange={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part4: { ...cur.parts.part4, answer: v } } }))} />
      <div style={{marginTop:12}}>
        <div className="label">iPad手書き（PNG保存）</div>
        <canvas ref={canvasRef} width={800} height={240} style={{border:'1px solid #e5e7eb', borderRadius:8, width:'100%', touchAction:'none'}}></canvas>
        <div style={{marginTop:8, display:'flex', gap:8}}>
          <button className="btn-solid-gray" onClick={() => { const dataUrl = canvasRef.current?.toDataURL("image/png"); if (!dataUrl) return; setWs((cur) => ({ ...cur, parts: { ...cur.parts, part4: { ...cur.parts.part4, handwriting: dataUrl } } })); }}>手書きを保存</button>
          {ws.parts.part4.handwriting && (<a className="btn" href={ws.parts.part4.handwriting} download="part4-writing.png">PNGをダウンロード</a>)}
        </div>
      </div>
      {/* Trainer notes for Part4 */}
      {mode === "trainer" ? (
        <div style={{marginTop:12}}>
          <div className="label">講師コメント</div>
          <DebouncedInput multiline rows={3} autoGrow className="input" value={ws.parts.part4.trainerNotes} onChange={(v) => setWs(cur => ({ ...cur, parts: { ...cur.parts, part4: { ...cur.parts.part4, trainerNotes: v } } }))} />
        </div>
      ) : (ws.parts.part4.trainerNotes ? (
        <div style={{marginTop:12, background:'#f9fafb', borderLeft:'4px solid #e5e7eb', padding:'8px 12px', borderRadius:8}}>
          <strong>講師コメント：</strong><br/>{ws.parts.part4.trainerNotes}
        </div>
      ) : null)}
    </Card>
  ));

  return (
    <div style={{minHeight:'100vh', background:'linear-gradient(to bottom, #fff, #f9fafb)'}}>
      <Header
        genre={genre}
        dateISO={dateISO}
        status={status}
        mode={mode}
        pinInput={pinInput}
        onPinChange={setPinInput}
        switchToTrainer={() => { if (pinInput === DEFAULT_PIN) { setMode('trainer'); } else { alert('PINが違います。'); } }}
        switchToStudent={() => setMode('student')}
        showCal={showCal}
        setShowCal={setShowCal}
        doSync={doSync}
        submit={submit}
        userId={userId}
        markedDates={markedDates}
        onPickDate={(iso)=>{ setDateISO(iso); setShowCal(false); }}
      />
      <ThemeBar />
      <Part1 />
      <Part2 />
      <Part3 />
      <Part4 />
      {/* Global Trainer Feedback */}
      {mode === "trainer" ? (
        <section className="container" style={{padding:'12px 16px'}}>
          <div className="card" style={{padding:'16px'}}>
            <h2 style={{fontSize:16, fontWeight:600, margin:'0 0 6px'}}>全体フィードバック</h2>
            <DebouncedInput multiline rows={4} autoGrow className="input" placeholder="今日のまとめコメントを入力" value={ws.trainerFeedback} onChange={(v)=> setWs(cur => ({ ...cur, trainerFeedback: v }))} />
          </div>
        </section>
      ) : (ws.trainerFeedback ? (
        <section className="container" style={{padding:'12px 16px'}}>
          <div className="card" style={{padding:'16px', background:'#f9fafb'}}>
            <h2 style={{fontSize:16, fontWeight:600, margin:'0 0 6px'}}>講師フィードバック</h2>
            <p style={{margin:0, whiteSpace:'pre-line'}}>{ws.trainerFeedback}</p>
          </div>
        </section>
      ) : null)}
      <footer className="container" style={{padding:'32px 16px', textAlign:'center', fontSize:12, color:'#6b7280'}}>©︎annetmii - 学習を習慣に</footer>
    </div>
  );
}
