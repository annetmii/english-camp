import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

// ===================== Utils =====================
// Vite/Netlify の古い Node/ブラウザでも動くよう、replaceAll は使わない
const tz = "Asia/Tokyo";
const ENDPOINT_STORAGE = "/.netlify/functions/storage";
const ENDPOINT_LIST = "/.netlify/functions/listDates";
const LS_PREFIX = "aec:v4.3:";

// UUID フォールバック（crypto.randomUUID が無い環境で白画面防止）
const genId = () => {
  const g = typeof globalThis !== "undefined" ? globalThis : window;
  if (g && g.crypto && typeof g.crypto.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
};

// アイドル時実行（requestIdleCallback が無い環境に対応）
const idle = (fn) =>
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? window.requestIdleCallback(fn)
    : setTimeout(fn, 0);

function todayISO(d = new Date()) {
  const z = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/\//g, "-"); // replaceAll の代替
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

// ===================== Cloud I/O =====================
async function cloudLoad({ userId, dateISO }) {
  const url = `${ENDPOINT_STORAGE}?user=${encodeURIComponent(
    userId
  )}&date=${dateISO}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  return res.json();
}
async function cloudSave({
  userId,
  dateISO,
  data,
  asTrainer = false,
  pin = "",
}) {
  const res = await fetch(ENDPOINT_STORAGE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: userId, date: dateISO, data, asTrainer, pin }),
  });
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
  id,
  value,
  onChange,
  className = "",
  placeholder = "",
  multiline = false,
  rows = 1,
  debounceMs = 220,
  autoGrow = true,
  ...rest // ← 末尾にカンマは付けない
}) {
  const [inner, setInner] = useState(value ?? "");
  const compRef = useRef(false); // IME合成中
  const tRef = useRef(null);
  const inputRef = useRef(null);

  // 親->子 同期（フォーカス中は上書きしない）
  useEffect(() => {
    if (compRef.current) return;
    if (typeof document !== "undefined" && document.activeElement === inputRef.current) return;
    setInner(value ?? "");
  }, [value]);

  const flush = useCallback(
    (next) => {
      if (typeof onChange !== "function") return;
      if (next === value) return;
      onChange(next);
    },
    [onChange, value]
  );

  const schedule = useCallback(
    (next) => {
      if (compRef.current) return;
      if (tRef.current) clearTimeout(tRef.current);
      tRef.current = setTimeout(() => flush(next), debounceMs);
    },
    [flush, debounceMs]
  );

  const resize = useCallback(() => {
    if (!autoGrow || !multiline || !inputRef.current) return;
    const el = inputRef.current;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 320) + "px";
  }, [autoGrow, multiline]);
  useEffect(() => {
    resize();
  }, [inner, resize]);

  const common = {
    ref: inputRef,
    className,
    placeholder,
    value: inner,
    onChange: (e) => {
      const v = e.target.value;
      setInner(v);
      schedule(v);
    },
    onBlur: () => flush(inner),
    onCompositionStart: () => {
      compRef.current = true;
    },
    onCompositionEnd: (e) => {
      compRef.current = false;
      const v = e.currentTarget.value;
      setInner(v);
      flush(v);
    },
    autoComplete: "off",
    autoCorrect: "off",
    spellCheck: false,
    inputMode: "text",
    ...rest,
  };
  if (!multiline) return <input {...common} />;
  return (
    <textarea
      {...common}
      rows={rows}
      style={{
        resize: "none",
        overflow: "hidden",
        ...(rest && rest.style ? rest.style : {}),
      }}
    />
  );
});

// ===================== Calendar helpers =====================
// ① ローカル保存されている日付（何か作業した日）を集める
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

// ② 「提出済み(submittedAtあり)」の日付だけを集める
function listLocalSubmittedDatesForUser(userId) {
  const prefix = `${LS_PREFIX}${userId}:`;
  const dates = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || "";
    if (!k.startsWith(prefix)) continue;
    try {
      const raw = localStorage.getItem(k);
      const obj = JSON.parse(raw || "{}");
      if (obj && obj.submittedAt) {
        const d = k.substring(prefix.length, prefix.length + 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
      }
    } catch {}
  }
  return dates;
}

function MonthCalendar({ dateISO, onSelect, marked, submitted }) {
  const d = new Date(`${dateISO}T00:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
  );

  return (
    <div className="card" style={{ padding: "12px", background: "white" }}>
      <div
        className="flex items-center justify-between mb-2"
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <button
            className="btn"
            onClick={() => onSelect(todayISO(new Date(y, m - 1, 1)))}
          >
            ◀
          </button>
        <div className="text-sm font-medium">
          {y}年{String(m + 1).padStart(2, "0")}月
        </div>
        <button
            className="btn"
            onClick={() => onSelect(todayISO(new Date(y, m + 1, 1)))}
          >
            ▶
          </button>
      </div>
      <div
        className="grid grid-cols-7 gap-1 text-center text-[11px] text-gray-500 mb-1"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          textAlign: "center",
          fontSize: 11,
          color: "#6b7280",
          marginBottom: 4,
        }}
      >
        {"月火水木金土日".split("").map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 gap-1"
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}
      >
        {days.map((dt) => {
          const iso = todayISO(dt);
          const inMonth = dt.getMonth() === m;
          const selected = iso === dateISO;
          const hasAny = marked.has(iso);
          const hasSubmit = submitted && submitted.has(iso);
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              className="btn"
              style={{
                height: 36,
                borderRadius: 12,
                position: "relative",
                background: selected ? "black" : "white",
                color: selected ? "white" : "#111827",
                opacity: inMonth ? 1 : 0.45,
              }}
            >
              {String(dt.getDate())}
              {hasAny && (
                <span
                  className={`cal-dot ${hasSubmit ? "cal-submit" : "cal-any"}`}
                />
              )}
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
        { id: genId(), en: "warning" },
        { id: genId(), en: "shelter" },
        { id: genId(), en: "evacuate" },
        { id: genId(), en: "calm" },
        { id: genId(), en: "debris" },
        { id: genId(), en: "inspect" },
        { id: genId(), en: "help" },
        { id: genId(), en: "take cover" },
      ],
      answers: {},
      marks: {},
      trainerNotes: "",
    },
    part2: {
      label: "Part 2｜構文トレーニング（穴埋め＋日本語訳）",
      instructions:
        "Part1の語彙を使って文を完成させ、日本語訳も入力してください。",
      items: [
        { id: genId(), prompt: "We need to follow the ______ from the radio." },
        { id: genId(), prompt: "Please stay ______ until we know it’s safe." },
        { id: genId(), prompt: "Let’s ______ the area before it’s too dangerous." },
        { id: genId(), prompt: "The city sent volunteers to ______ the elderly." },
        { id: genId(), prompt: "After the storm, we need to ______ the power lines." },
      ],
      answers: {},
      marks: {},
      trainerNotes: "",
    },
    part3: {
      label: "Part 3｜会話ロールプレイ",
      instructions: "英文を入力して会話を完成させてください。",
      items: [
        {
          id: genId(),
          otherRole: "Coworker",
          otherEn:
            "Hey Masayuki, did you hear they issued a tsunami warning?",
          jp: "はい。日々の訓練通り、落ち着いて速やかに行動しましょう。",
        },
        {
          id: genId(),
          otherRole: "Coworker",
          otherEn:
            "Please stay calm and follow the official instructions.",
          jp: "まずは警告を確認して指示に従いましょう。",
        },
        {
          id: genId(),
          otherRole: "Coworker",
          otherEn: "Shall we evacuate to higher ground now?",
          jp: "はい。急いで準備をして高台に行きましょう。",
        },
        {
          id: genId(),
          otherRole: "Coworker",
          otherEn: "Do you need any help with your bag?",
          jp: "いいえ。一緒に安全を確保しましょう。",
        },
      ],
      answers: {},
      marks: {},
      trainerNotes: "",
    },
    part4: {
      label: "Part 4｜英作文",
      instructions:
        "本日のテーマに沿って80–120語で英作文を作ろう。iPadは手書きも可（PNG保存）。",
      answer: "",
      handwriting: null,
      trainerNotes: "",
    },
  },
  trainerFeedback: "",
  submittedAt: null,
});

// ===================== Header (4-lines compact layout) =====================
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
  submittedDates,
  onPickDate,
}) {
  return (
    <header className="sticky-header">
      {/* 1行目：ロゴ＋annetmii English Camp */}
      <div className="header-bar">
        <div className="container">
          <div className="brand">
            <img
              src="/logo.png"
              alt="annetmii"
              className="header-logo"
              onError={(e) => {
                const s = document.createElement("span");
                s.textContent = "annetmii";
                e.currentTarget.replaceWith(s);
              }}
            />
            <h1 className="brand-title">annetmii English Camp</h1>
          </div>
        </div>
      </div>

      {/* 2行目：カレンダー／PIN／講師モード */}
      <div className="header-row">
        <div className="container">
          <div className="hstack">
            <button
              className="hdr-btn"
              onClick={(ev) => {
                ev.stopPropagation();
                setShowCal((v) => !v);
              }}
            >
              カレンダー
            </button>
            {mode === "student" ? (
              <>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  className="pin-4ch"
                  placeholder="PIN"
                  value={pinInput}
                  onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ""))}
                  aria-label="講師PIN"
                />
                <button
                  className="hdr-btn-primary"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    switchToTrainer();
                  }}
                >
                  講師モード
                </button>
              </>
            ) : (
              <button
                className="hdr-btn"
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
      </div>

      {/* 3行目：同期／提出／ステータス */}
      <div className="header-row">
        <div className="container">
          <div className="hstack" style={{ justifyContent: "space-between" }}>
            <div className="hstack">
              <button
                className="hdr-btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  doSync("手動同期");
                }}
              >
                同期
              </button>
              <button
                className="hdr-btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  submit();
                }}
              >
                提出
              </button>
            </div>
            <span style={{ color: "#6b7280", fontSize: 13 }}>
              ステータス：{status}
            </span>
          </div>
        </div>
      </div>

      {/* 4行目：ジャンル｜日付（改行禁止） */}
      <div className="header-row">
        <div className="container">
          <div className="hdr-meta">
            {genre}｜{dateISO}
          </div>
        </div>
      </div>

      {/* カレンダー（必要時） */}
      {showCal && (
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
            submitted={submittedDates}
          />
        </div>
      )}
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
  const genre = useMemo(
    () => DAY_GENRE[new Date(`${dateISO}T00:00:00`).getDay()],
    [dateISO]
  );

  // expose setter for header calendar selection
  useEffect(() => {
    window.__aec_setDate = (iso) => setDateISO(iso);
    return () => {
      delete window.__aec_setDate;
    };
  }, []);

  // localStorage save (batched 500ms + idle)
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(
      () =>
        idle(() => {
          try {
            localStorage.setItem(
              `${LS_PREFIX}${userId}:${ws.meta.date}`,
              JSON.stringify(ws)
            );
          } catch {}
        }),
      500
    );
    return () => clearTimeout(saveTimerRef.current);
  }, [ws, userId]);

  // load cloud on start/date change
  useEffect(() => {
    (async () => {
      try {
        setStatus("クラウド読込中…");
        const remote = await cloudLoad({ userId, dateISO });
        if (remote && remote.data) {
          setWs(remote.data);
          setStatus("クラウドから読み込みました");
        } else {
          setWs((cur) =>
            cur && cur.meta && cur.meta.date === dateISO
              ? cur
              : defaultWorksheet(dateISO)
          );
          setStatus("本日のワークシートを作成しました");
        }
      } catch {
        setStatus("オフライン：ローカル保存のみ");
      }
    })();
  }, [userId, dateISO]);

  // fetch cloud dates (for ◎ marking)
  const refreshCloudDates = useCallback(async () => {
    try {
      const res = await cloudListDates({ userId });
      setCloudDates(new Set(res.dates || []));
    } catch {}
  }, [userId]);
  useEffect(() => {
    refreshCloudDates();
  }, [refreshCloudDates]);

  const markedDates = useMemo(() => {
    const set = new Set(listLocalDatesForUser(userId));
    cloudDates.forEach((d) => set.add(d));
    return set;
  }, [userId, cloudDates]);

  const submittedDates = useMemo(() => {
    return listLocalSubmittedDatesForUser(userId);
  }, [userId, ws]); // ws 更新でも再判定

  // ============= Input batching for Parts answers =============
  const draftRef = useRef({ p1: {}, p2: {}, p3: {} });
  const flushTimerRef = useRef(null);
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      const d = draftRef.current;
      draftRef.current = { p1: {}, p2: {}, p3: {} };
      if (
        Object.keys(d.p1).length ||
        Object.keys(d.p2).length ||
        Object.keys(d.p3).length
      ) {
        setWs((cur) => {
          const next = { ...cur, parts: { ...cur.parts } };
          if (Object.keys(d.p1).length)
            next.parts.part1 = {
              ...cur.parts.part1,
              answers: { ...(cur.parts.part1.answers || {}), ...d.p1 },
            };
          if (Object.keys(d.p2).length)
            next.parts.part2 = {
              ...cur.parts.part2,
              answers: { ...(cur.parts.part2.answers || {}), ...d.p2 },
            };
          if (Object.keys(d.p3).length)
            next.parts.part3 = {
              ...cur.parts.part3,
              answers: { ...(cur.parts.part3.answers || {}), ...d.p3 },
            };
          return next;
        });
      }
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }, 300);
  }, []);

  // ============= Cloud auto-sync =============
  const lastChangeRef = useRef(Date.now());
  useEffect(() => {
    lastChangeRef.current = Date.now();
  }, [ws]); // update timestamp on any ws change

  useEffect(() => {
    const id = setInterval(async () => {
      const idleFor = Date.now() - lastChangeRef.current;
      if (idleFor >= 60000) {
        try {
          setStatus("自動同期中…");
          await cloudSave({
            userId,
            dateISO,
            data: ws,
            asTrainer: mode === "trainer",
            pin: mode === "trainer" ? pinInput : "",
          });
          setStatus("自動同期完了");
          refreshCloudDates();
        } catch {
          setStatus("自動同期失敗：後で再試行");
        }
        lastChangeRef.current = Date.now(); // reset
      }
    }, 5000);
    return () => clearInterval(id);
  }, [userId, dateISO, ws, mode, pinInput, refreshCloudDates]);

  const doSync = useCallback(
    async (reason = "同期") => {
      try {
        setStatus(`${reason}中…`);
        await cloudSave({
          userId,
          dateISO,
          data: ws,
          asTrainer: mode === "trainer",
          pin: mode === "trainer" ? pinInput : "",
        });
        setStatus(`${reason}完了`);
        refreshCloudDates();
      } catch {
        setStatus(`${reason}失敗：後で再試行`);
      }
    },
    [userId, dateISO, ws, mode, pinInput, refreshCloudDates]
  );

  const submit = useCallback(() => {
    setWs((c) => ({ ...c, submittedAt: new Date().toISOString() }));
    doSync("提出");
  }, [doSync]);

  const switchToTrainer = useCallback(() => {
    if (pinInput === DEFAULT_PIN) {
      setMode("trainer");
    } else {
      alert("PINが違います。");
    }
  }, [pinInput]);
  const switchToStudent = useCallback(() => setMode("student"), []);

  // ===================== UI Shell =====================
  const Card = ({ title, children, instructions }) => (
    <section className="container" style={{ padding: "12px 16px" }}>
      <div className="card">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>
            {title}
          </h2>
          {instructions ? (
            <div className="label" style={{ lineHeight: 1.6 }}>
              {instructions}
            </div>
          ) : null}
        </div>
        <div className="content-pad">{children}</div>
      </div>
    </section>
  );

  const ThemeBar = React.memo(() => (
    <Card title="本日のテーマ">
      <DebouncedInput
        id="theme"
        key="theme"
        multiline
        rows={2}
        autoGrow
        className="input field-full"
        placeholder="Week 4｜Tuesday（Emergency）- 緊急事態に備えよう　Picture Dictionaryの「Emergency Procedures」（p.147）から学びましょう"
        value={ws.meta.theme}
        onChange={(v) =>
          setWs((cur) => ({ ...cur, meta: { ...cur.meta, theme: v } }))
        }
      />
    </Card>
  ));

  // Part1 Row
  const Part1Row = React.memo(function Part1Row({ it, idx }) {
    const answerMap = ws.parts.part1.answers || {};
    const answer = answerMap[it.id] !== undefined ? answerMap[it.id] : "";
    const mark = ws.parts.part1.marks[it.id]; // 'ok' | 'wrong' | undefined
    const isWrong = mark === "wrong";
    const isOk = mark === "ok";

    const onChangeWord = (v) =>
      setWs((cur) => ({
        ...cur,
        parts: {
          ...cur.parts,
          part1: {
            ...cur.parts.part1,
            items: cur.parts.part1.items.map((x) =>
              x.id === it.id ? { ...x, en: v } : x
            ),
          },
        },
      }));

    const onChangeAnswer = (v) => {
      draftRef.current.p1[it.id] = v;
      scheduleFlush();
    };

    const setMark = (val) =>
      setWs((cur) => ({
        ...cur,
        parts: {
          ...cur.parts,
          part1: { ...cur.parts.part1, marks: { ...cur.parts.part1.marks, [it.id]: val } },
        },
      }));

    const clearMark = () =>
      setWs((cur) => {
        const m = { ...cur.parts.part1.marks };
        delete m[it.id];
        return { ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, marks: m } } };
      });

    const removeItem = () =>
      setWs((cur) => {
        const items = cur.parts.part1.items.filter((x) => x.id !== it.id);
        const answers = { ...(cur.parts.part1.answers || {}) };
        delete answers[it.id];
        const marks = { ...cur.parts.part1.marks };
        delete marks[it.id];
        return {
          ...cur,
          parts: {
            ...cur.parts,
            part1: { ...cur.parts.part1, items, answers, marks },
          },
        };
      });

    return (
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
        <span className="label" style={{ width: 24 }}>{idx + 1}.</span>

        {mode === "trainer" ? (
          <DebouncedInput className="input" style={{ width: 120 }} value={it.en} onChange={onChangeWord} />
        ) : (
          <span style={{ fontWeight: 600, minWidth: 88 }}>{it.en}</span>
        )}

        <DebouncedInput
          className={`input ${isWrong ? "answer-wrong" : ""} ${isOk ? "answer-correct" : ""}`}
          style={{ flex: 1 }}
          placeholder="日本語訳"
          value={answer}
          onChange={onChangeAnswer}
        />

        {mode === "trainer" && (
          <>
            <div className="mark-wrap">
              <button type="button" className="mark-btn ok" onClick={() => setMark("ok")}>○</button>
              <button type="button" className="mark-btn wrong" onClick={() => setMark("wrong")}>×</button>
              <button type="button" className="mark-btn clear" onClick={clearMark}>消</button>
            </div>
            <button className="btn" onClick={removeItem} style={{ color: "#ef4444" }}>削除</button>
          </>
        )}
      </div>
    );
  });

  const Part1 = React.memo(() => (
    <Card title={ws.parts.part1.label} instructions={ws.parts.part1.instructions}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {ws.parts.part1.items.map((it, idx) => (
          <Part1Row key={it.id} it={it} idx={idx} />
        ))}
      </div>
      {mode === "trainer" && (
        <div style={{ paddingTop: 8, display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={() =>
              setWs((cur) => ({
                ...cur,
                parts: {
                  ...cur.parts,
                  part1: {
                    ...cur.parts.part1,
                    items: [
                      ...cur.parts.part1.items,
                      { id: genId(), en: "new word" },
                    ],
                  },
                },
              }))
            }
          >
            語彙を追加
          </button>
        </div>
      )}
      {/* Trainer notes for Part1 */}
      {mode === "trainer" ? (
        <div style={{ marginTop: 12 }}>
          <div className="label">講師コメント</div>
          <DebouncedInput
            id="p1-notes"
            key="p1-notes"
            multiline
            rows={3}
            autoGrow
            className="input field-full"
            value={ws.parts.part1.trainerNotes}
            onChange={(v) =>
              setWs((cur) => ({
                ...cur,
                parts: {
                  ...cur.parts,
                  part1: { ...cur.parts.part1, trainerNotes: v },
                },
              }))
            }
          />
        </div>
      ) : ws.parts.part1.trainerNotes ? (
        <div
          style={{
            marginTop: 12,
            background: "#f9fafb",
            borderLeft: "4px solid #e5e7eb",
            padding: "8px 12px",
            borderRadius: 8,
          }}
        >
          <strong>講師コメント：</strong>
          <br />
          {ws.parts.part1.trainerNotes}
        </div>
      ) : null}
    </Card>
  ));

  // ===================== Part 2 =====================
  const Part2 = React.memo(function Part2() {
    return (
      <Card title={ws.parts.part2.label} instructions={ws.parts.part2.instructions}>
        {ws.parts.part2.items.map((it, idx) => {
          const ansMap = ws.parts.part2.answers || {};
          const ans = ansMap[it.id] || { en: "", ja: "" };

          const markMap = ws.parts.part2.marks || {};
          const mark = markMap[it.id];
          const wrong2 = mark === "wrong";
          const ok2 = mark === "ok";

          const setMark2 = (val) =>
            setWs((c) => ({
              ...c,
              parts: {
                ...c.parts,
                part2: {
                  ...c.parts.part2,
                  marks: { ...(c.parts.part2.marks || {}), [it.id]: val },
                },
              },
            }));

          const clearMark2 = () =>
            setWs((c) => {
              const m = { ...(c.parts.part2.marks || {}) };
              delete m[it.id];
              return {
                ...c,
                parts: { ...c.parts, part2: { ...c.parts.part2, marks: m } },
              };
            });

          return (
            <div key={it.id} style={{ marginBottom: 12 }}>
              {/* 1行目：出題（講師は編集可） */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span className="label" style={{ width: 24 }}>{idx + 1}.</span>
                {mode === "trainer" ? (
                  <DebouncedInput
                    className="input field-full"
                    value={it.prompt}
                    onChange={(v) =>
                      setWs((cur) => ({
                        ...cur,
                        parts: {
                          ...cur.parts,
                          part2: {
                            ...cur.parts.part2,
                            items: cur.parts.part2.items.map((x) =>
                              x.id === it.id ? { ...x, prompt: v } : x
                            ),
                          },
                        },
                      }))
                    }
                  />
                ) : (
                  <p style={{ margin: 0, lineHeight: 1.6, flex: 1 }}>{it.prompt}</p>
                )}
              </div>

              {/* 講師用：採点マーク */}
              {mode === "trainer" && (
                <div className="hstack" style={{ paddingLeft: 32, marginTop: 6 }}>
                  <button
                    className={"hdr-btn" + (ok2 ? " hdr-btn-primary" : "")}
                    onClick={() => setMark2("ok")}
                    aria-label="正解"
                    title="正解（○）"
                  >
                    ○
                  </button>
                  <button
                    className={"hdr-btn" + (wrong2 ? " hdr-btn-primary" : "")}
                    onClick={() => setMark2("wrong")}
                    aria-label="不正解"
                    title="不正解（×）"
                  >
                    ×
                  </button>
                  <button className="hdr-btn" onClick={clearMark2} aria-label="採点解除">
                    クリア
                  </button>
                </div>
              )}

              {/* 2行目：学習者回答 */}
              <div
                style={{
                  paddingLeft: 32,
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <DebouncedInput
                  className={"input field-full " + (wrong2 ? "mark-wrong" : ok2 ? "mark-ok" : "")}
                  placeholder="英語の答え（穴埋め）"
                  value={ans.en !== undefined && ans.en !== null ? ans.en : ""}
                  onChange={(v) => {
                    draftRef.current.p2[it.id] = {
                      ...(draftRef.current.p2[it.id] || ans),
                      en: v,
                    };
                    scheduleFlush();
                  }}
                />
                <DebouncedInput
                  className={"input field-full " + (wrong2 ? "mark-wrong" : ok2 ? "mark-ok" : "")}
                  placeholder="日本語訳"
                  value={ans.ja !== undefined && ans.ja !== null ? ans.ja : ""}
                  onChange={(v) => {
                    draftRef.current.p2[it.id] = {
                      ...(draftRef.current.p2[it.id] || ans),
                      ja: v,
                    };
                    scheduleFlush();
                  }}
                />
              </div>
            </div>
          );
        })}

        {/* 講師コメント */}
        {mode === "trainer" ? (
          <div style={{ marginTop: 12 }}>
            <div className="label">講師コメント</div>
            <DebouncedInput
              multiline
              rows={3}
              autoGrow
              className="input field-full trainer-note"
              value={ws.parts.part2.trainerNotes || ""}
              onChange={(v) =>
                setWs((cur) => ({
                  ...cur,
                  parts: {
                    ...cur.parts,
                    part2: { ...cur.parts.part2, trainerNotes: v },
                  },
                }))
              }
            />
          </div>
        ) : ws.parts.part2.trainerNotes ? (
          <div
            style={{
              marginTop: 12,
              background: "#f9fafb",
              borderLeft: "4px solid #e5e7eb",
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            <strong>講師コメント：</strong>
            <br />
            {ws.parts.part2.trainerNotes}
          </div>
        ) : null}
      </Card>
    );
  });

  // ===================== Part 3 =====================
  const Part3 = React.memo(() => (
    <Card title={ws.parts.part3.label} instructions={ws.parts.part3.instructions}>
      {ws.parts.part3.items.map((it, idx) => {
        const ans3Map = ws.parts.part3.answers || {};
        const m3 = (ws.parts.part3.marks || {})[it.id];
        const wrong3 = m3 === "wrong";
        const ok3 = m3 === "ok";

        const setMark3 = (val) =>
          setWs((c) => ({
            ...c,
            parts: {
              ...c.parts,
              part3: {
                ...c.parts.part3,
                marks: { ...(c.parts.part3.marks || {}), [it.id]: val },
              },
            },
          }));
        const clearMark3 = () =>
          setWs((c) => {
            const m = { ...(c.parts.part3.marks || {}) };
            delete m[it.id];
            return {
              ...c,
              parts: { ...c.parts, part3: { ...c.parts.part3, marks: m } },
            };
          });

        return (
          <div key={it.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span className="label" style={{ width: 24 }}>{idx + 1}.</span>
              <div style={{ flex: 1 }}>
                {mode === "trainer" ? (
                  <DebouncedInput
                    className="input field-full"
                    style={{ marginBottom: 6 }}
                    value={it.otherRole || ""}
                    placeholder="相手役の名前（例：Coworker）"
                    onChange={(v) =>
                      setWs((cur) => ({
                        ...cur,
                        parts: {
                          ...cur.parts,
                          part3: {
                            ...cur.parts.part3,
                            items: cur.parts.part3.items.map((x) =>
                              x.id === it.id ? { ...x, otherRole: v } : x
                            ),
                          },
                        },
                      }))
                    }
                  />
                ) : it.otherRole ? (
                  <div className="label" style={{ marginBottom: 6 }}>
                    {it.otherRole}
                  </div>
                ) : null}

                {mode === "trainer" ? (
                  <DebouncedInput
                    className="input field-full"
                    placeholder="相手の英語セリフ"
                    value={it.otherEn || ""}
                    onChange={(v) =>
                      setWs((cur) => ({
                        ...cur,
                        parts: {
                          ...cur.parts,
                          part3: {
                            ...cur.parts.part3,
                            items: cur.parts.part3.items.map((x) =>
                              x.id === it.id ? { ...x, otherEn: v } : x
                            ),
                          },
                        },
                      }))
                    }
                  />
                ) : (
                  <p style={{ margin: 0, lineHeight: 1.6 }}>{it.otherEn}</p>
                )}
              </div>
            </div>

            <div style={{ paddingLeft: 32, marginTop: 8 }}>
              <div className="label">Masayuki</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <DebouncedInput
                  multiline
                  rows={2}
                  autoGrow
                  className={`input ${wrong3 ? "answer-wrong" : ""} ${ok3 ? "answer-correct" : ""}`}
                  placeholder="英語：ここに英訳を入力"
                  value={
                    ans3Map[it.id] !== undefined && ans3Map[it.id] !== null
                      ? ans3Map[it.id]
                      : ""
                  }
                  onChange={(v) => {
                    draftRef.current.p3[it.id] = v;
                    scheduleFlush();
                  }}
                />
                {mode === "trainer" && (
                  <div className="mark-wrap">
                    <button type="button" className="mark-btn ok" onClick={() => setMark3("ok")}>○</button>
                    <button type="button" className="mark-btn wrong" onClick={() => setMark3("wrong")}>×</button>
                    <button type="button" className="mark-btn clear" onClick={clearMark3}>消</button>
                  </div>
                )}
              </div>

              <div className="label" style={{ marginTop: 8 }}>日本語</div>
              {mode === "trainer" ? (
                <DebouncedInput
                  multiline
                  rows={2}
                  autoGrow
                  className="input field-full"
                  value={it.jp || ""}
                  onChange={(v) =>
                    setWs((cur) => ({
                      ...cur,
                      parts: {
                        ...cur.parts,
                        part3: {
                          ...cur.parts.part3,
                          items: cur.parts.part3.items.map((x) =>
                            x.id === it.id ? { ...x, jp: v } : x
                          ),
                        },
                      },
                    }))
                  }
                />
              ) : (
                <p style={{ margin: 0, lineHeight: 1.6 }}>{it.jp}</p>
              )}
            </div>
          </div>
        );
      })}
      {mode === "trainer" && (
        <div style={{ paddingTop: 8, display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={() =>
              setWs((cur) => ({
                ...cur,
                parts: {
                  ...cur.parts,
                  part3: {
                    ...cur.parts.part3,
                    items: [
                      ...cur.parts.part3.items,
                      { id: genId(), otherRole: "", otherEn: "", jp: "" },
                    ],
                  },
                },
              }))
            }
          >
            セリフを追加
          </button>
        </div>
      )}
      {/* Trainer notes for Part3 */}
      {mode === "trainer" ? (
        <div style={{ marginTop: 12 }}>
          <div className="label">講師コメント</div>
          <DebouncedInput
            id="p3-notes"
            key="p3-notes"
            multiline
            rows={3}
            autoGrow
            className="input field-full"
            value={ws.parts.part3.trainerNotes || ""}
            onChange={(v) =>
              setWs((cur) => ({
                ...cur,
                parts: {
                  ...cur.parts,
                  part3: { ...cur.parts.part3, trainerNotes: v },
                },
              }))
            }
          />
        </div>
      ) : ws.parts.part3.trainerNotes ? (
        <div
          style={{
            marginTop: 12,
            background: "#f9fafb",
            borderLeft: "4px solid #e5e7eb",
            padding: "8px 12px",
            borderRadius: 8,
          }}
        >
          <strong>講師コメント：</strong>
          <br />
          {ws.parts.part3.trainerNotes}
        </div>
      ) : null}
    </Card>
  ));

  // Part4 (handwriting)
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let drawing = false;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const t = e.touches && e.touches[0];
      const x = (t ? t.clientX : e.clientX) - r.left;
      const y = (t ? t.clientY : e.clientY) - r.top;
      return { x, y };
    };
    const start = (e) => {
      drawing = true;
      const { x, y } = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (e) => {
      if (!drawing) return;
      const { x, y } = pos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    const end = () => {
      drawing = false;
    };
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("touchstart", start, { passive: true });
    canvas.addEventListener("touchmove", move, { passive: true });
    canvas.addEventListener("touchend", end);
    return () => {
      canvas.removeEventListener("mousedown", start);
      canvas.removeEventListener("mousemove", move);
      canvas.removeEventListener("mouseup", end);
      canvas.removeEventListener("mouseleave", end);
      canvas.removeEventListener("touchstart", start);
      canvas.removeEventListener("touchmove", move);
      canvas.removeEventListener("touchend", end);
    };
  }, []);

  const Part4 = React.memo(() => (
    <Card title={ws.parts.part4.label} instructions={ws.parts.part4.instructions}>
      <DebouncedInput
        multiline
        rows={3}
        autoGrow
        className="input field-full"
        placeholder="ここに英作文を入力してください"
        value={ws.parts.part4.answer || ""}
        onChange={(v) =>
          setWs((cur) => ({
            ...cur,
            parts: { ...cur.parts, part4: { ...cur.parts.part4, answer: v } },
          }))
        }
      />
      <div style={{ marginTop: 12 }}>
        <div className="label">iPad手書き（PNG保存）</div>
        <canvas
          ref={canvasRef}
          width={800}
          height={240}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            width: "100%",
            touchAction: "none",
          }}
        ></canvas>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button
            className="btn-solid-gray"
            onClick={() => {
              const c = canvasRef.current;
              const dataUrl = c && c.toDataURL ? c.toDataURL("image/png") : null;
              if (!dataUrl) return;
              setWs((cur) => ({
                ...cur,
                parts: {
                  ...cur.parts,
                  part4: { ...cur.parts.part4, handwriting: dataUrl },
                },
              }));
            }}
          >
            手書きを保存
          </button>
          {ws.parts.part4.handwriting && (
            <a className="btn" href={ws.parts.part4.handwriting} download="part4-writing.png">
              PNGをダウンロード
            </a>
          )}
        </div>
      </div>
      {/* Trainer notes for Part4 */}
      {mode === "trainer" ? (
        <div style={{ marginTop: 12 }}>
          <div className="label">講師コメント</div>
          <DebouncedInput
            id="p4-notes"
            key="p4-notes"
            multiline
            rows={3}
            autoGrow
            className="input field-full"
            value={ws.parts.part4.trainerNotes || ""}
            onChange={(v) =>
              setWs((cur) => ({
                ...cur,
                parts: {
                  ...cur.parts,
                  part4: { ...cur.parts.part4, trainerNotes: v },
                },
              }))
            }
          />
        </div>
      ) : ws.parts.part4.trainerNotes ? (
        <div
          style={{
            marginTop: 12,
            background: "#f9fafb",
            borderLeft: "4px solid #e5e7eb",
            padding: "8px 12px",
            borderRadius: 8,
          }}
        >
          <strong>講師コメント：</strong>
          <br />
          {ws.parts.part4.trainerNotes}
        </div>
      ) : null}
    </Card>
  ));

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(to bottom, #fff, #f9fafb)" }}>
      <Header
        genre={genre}
        dateISO={dateISO}
        status={status}
        mode={mode}
        pinInput={pinInput}
        onPinChange={setPinInput}
        switchToTrainer={() => {
          if (pinInput === DEFAULT_PIN) {
            setMode("trainer");
          } else {
            alert("PINが違います。");
          }
        }}
        switchToStudent={() => setMode("student")}
        showCal={showCal}
        setShowCal={setShowCal}
        doSync={doSync}
        submit={submit}
        userId={userId}
        markedDates={markedDates}
        submittedDates={submittedDates}
        onPickDate={(iso) => {
          setDateISO(iso);
          setShowCal(false);
        }}
      />
      <ThemeBar />
      <Part1 />
      <Part2 />
      <Part3 />
      <Part4 />
      {/* Global Trainer Feedback */}
      {mode === "trainer" ? (
        <section className="container" style={{ padding: "12px 16px" }}>
          <div className="card" style={{ padding: "16px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>
              全体フィードバック
            </h2>
            <DebouncedInput
              id="global-notes"
              key="global-notes"
              multiline
              rows={4}
              autoGrow
              className="input field-full"
              placeholder="今日のまとめコメントを入力"
              value={ws.trainerFeedback || ""}
              onChange={(v) => setWs((cur) => ({ ...cur, trainerFeedback: v }))}
            />
          </div>
        </section>
      ) : ws.trainerFeedback ? (
        <section className="container" style={{ padding: "12px 16px" }}>
          <div className="card" style={{ padding: "16px", background: "#f9fafb" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>
              講師フィードバック
            </h2>
            <p style={{ margin: 0, whiteSpace: "pre-line" }}>{ws.trainerFeedback}</p>
          </div>
        </section>
      ) : null}
      <footer
        className="container"
        style={{
          padding: "32px 16px",
          textAlign: "center",
          fontSize: 12,
          color: "#6b7280",
        }}
      >
        ©︎annetmii - 学習を習慣に
      </footer>
    </div>
  );
}
