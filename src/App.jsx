import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

/* ===================== Utils ===================== */
const tz = "Asia/Tokyo";
const ENDPOINT_STORAGE = "/.netlify/functions/storage";
const ENDPOINT_LIST = "/.netlify/functions/listDates";
const LS_PREFIX = "aec:v4.3:";
const DEFAULT_PIN = "1202";

const genId = () => {
  const g = typeof globalThis !== "undefined" ? globalThis : window;
  if (g && g.crypto && typeof g.crypto.randomUUID === "function") return g.crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
};

const idle = (fn) =>
  typeof window !== "undefined" && "requestIdleCallback" in window
    ? window.requestIdleCallback(fn)
    : setTimeout(fn, 0);

function todayISO(d = new Date()) {
  const z = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d).replace(/\//g, "-");
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

/* ===================== Cloud I/O ===================== */
async function cloudLoad({ userId, dateISO }) {
  const url = `${ENDPOINT_STORAGE}?user=${encodeURIComponent(userId)}&date=${dateISO}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  return res.json();
}
async function cloudSave({ userId, dateISO, data, asTrainer = false, pin = "" }) {
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
  flushOnBlur = true,
  ...rest
}) {
  const [inner, setInner] = useState(value ?? "");
  const compRef = useRef(false);       // IME中フラグ
  const tRef = useRef(null);           // debounce タイマ
  const inputRef = useRef(null);       // 実DOM
  const focusedRef = useRef(false);    // 直近でフォーカスを持っていたか
  const lockRef = useRef(false);       // 一時的に親からの value 反映をブロック

  // 親→子 同期：フォーカス中は**絶対に上書きしない**
  useEffect(() => {
    if (compRef.current) return;
    if (focusedRef.current) return;            // ← ここが効きます
    if (!lockRef.current) setInner(value ?? "");
  }, [value]);

  const flush = useCallback((next) => {
    if (typeof onChange !== "function") return;
    if (next === value) return;
    onChange(next);
  }, [onChange, value]);

  const schedule = useCallback((next) => {
    if (compRef.current) return;
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => {
      lockRef.current = false;                 // 送信後ロック解除
      flush(next);
    }, debounceMs);
  }, [flush, debounceMs]);

  // iOSでのフォーカス復帰（再レンダー後でも保持）
  useEffect(() => {
    if (focusedRef.current && inputRef.current) {
      try { inputRef.current.focus({ preventScroll: true }); } catch {}
    }
  });

  const resize = useCallback(() => {
    if (!autoGrow || !multiline || !inputRef.current) return;
    const el = inputRef.current;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 320) + "px";
  }, [autoGrow, multiline]);
  useEffect(() => { resize(); }, [inner, resize]);

  const common = {
    ref: inputRef,
    className,
    placeholder,
    value: inner,                         // 完全に内部状態で制御
    onChange: (e) => {
      const v = e.target.value;
      setInner(v);
      lockRef.current = true;            // 親からの value 反映を一時ロック
      schedule(v);
    },
    onFocus: () => { focusedRef.current = true; },
    onBlur: () => {
      focusedRef.current = false;
      lockRef.current = false;
      if (flushOnBlur) flush(inner);
    },
    onCompositionStart: () => { compRef.current = true; },
    onCompositionEnd: (e) => {
      compRef.current = false;
      const v = e.currentTarget.value;
      setInner(v);
      flush(v);
    },
    // 近くのボタンや親のクリックがフォーカスを奪わないように
    onMouseDownCapture: (e) => { e.stopPropagation(); },
    onTouchStartCapture: (e) => { e.stopPropagation(); },
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
      style={{ resize: "none", overflow: "hidden", ...(rest && rest.style ? rest.style : {}) }}
    />
  );
});

// ====== Part1Row（トップレベル版）======
const Part1Row = React.memo(function Part1Row({ it }) {
  const answerMap = ws.parts.part1.answers || {};
  const answer = answerMap[it.id] !== undefined ? answerMap[it.id] : "";
  const mark = (ws.parts.part1.marks || {})[it.id];   // 'ok' | 'wrong' | undefined
  const isWrong = mark === "wrong";
  const isOk = mark === "ok";

  const onChangeWord = (v) =>
    setWs((cur) => {
      const items = cur.parts.part1.items;
      const idx = items.findIndex((x) => x.id === it.id);
      if (idx < 0) return cur;
      const curVal = items[idx].en || "";
      if (curVal === (v ?? "")) return cur; // 変更なしなら何もしない
      const next = [...items]; next[idx] = { ...next[idx], en: v };
      return { ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, items: next } } };
    });

  const onChangeAnswer = (v) => { draftRef.current.p1[it.id] = v; scheduleFlush(); };

  const setMark = (val) =>
    setWs((cur) => ({
      ...cur,
      parts: {
        ...cur.parts,
        part1: { ...cur.parts.part1, marks: { ...(cur.parts.part1.marks || {}), [it.id]: val } },
      },
    }));

  const clearMark = () =>
    setWs((cur) => {
      const m = { ...(cur.parts.part1.marks || {}) };
      delete m[it.id];
      return { ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, marks: m } } };
    });

  return (
    <div className="p1-row">
      {mode === "trainer" ? (
        <DebouncedInput
          className="input p1-word"
          value={it.en}
          onChange={onChangeWord}
          flushOnBlur={false}
        />
      ) : (
        <span className="p1-word">{it.en}</span>
      )}

      <DebouncedInput
        className={`input p1-answer ${isWrong ? "answer-wrong" : ""} ${isOk ? "answer-correct" : ""}`}
        placeholder="日本語訳"
        value={answer}
        onChange={onChangeAnswer}
      />

      {mode === "trainer" && (
        <div className="mark-wrap">
          <button className="mark-btn ok"    onMouseDown={(e)=>e.preventDefault()} onClick={() => setMark("ok")}>○</button>
          <button className="mark-btn wrong" onMouseDown={(e)=>e.preventDefault()} onClick={() => setMark("wrong")}>×</button>
          <button className="mark-btn clear" onMouseDown={(e)=>e.preventDefault()} onClick={clearMark}>消</button>
        </div>
      )}
    </div>
  );
});

// ====== Part1（トップレベル版）======
const Part1 = React.memo(function Part1({ Card, ws, setWs, mode, draftRef, scheduleFlush }) {
  return (
    <Card title={ws.parts.part1.label} instructions={ws.parts.part1.instructions}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {ws.parts.part1.items.map((it) => (
          <Part1Row key={it.id} it={it} mode={mode} ws={ws} setWs={setWs} draftRef={draftRef} scheduleFlush={scheduleFlush} />
        ))}
      </div>
      {mode === "trainer" && (
        <div style={{ paddingTop: 8, display: "flex", gap: 8 }}>
          <button className="btn btn-primary" 
            onMouseDown={(e)=>e.preventDefault()}
            onClick={() => setWs((cur) => ({
            ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, items: [...cur.parts.part1.items, { id: genId(), en: "" }] } }
          }))}>語彙を追加</button>
        </div>
      )}
      {mode === "trainer" ? (
        <div style={{ marginTop: 12 }}>
          <div className="label">講師コメント</div>
          <DebouncedInput multiline rows={3} autoGrow className="input field-full teacher-comment"
            value={ws.parts.part1.trainerNotes || ""}
            onChange={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, trainerNotes: v } } }))} />
        </div>
      ) : ws.parts.part1.trainerNotes ? (
        <div style={{marginTop:12, background:'#f9fafb', borderLeft:'4px solid #e5e7eb', padding:'8px 12px', borderRadius:8, color:'#b91c1c'}}>
          <strong>講師コメント：</strong><br/>{ws.parts.part1.trainerNotes}
        </div>
      ) : null}
    </Card>
  );
});

// ====== Part2（トップレベル版）======
const Part2 = React.memo(function Part2({ Card, ws, setWs, mode, draftRef, scheduleFlush }) {
  return (
    <Card title={ws.parts.part2.label} instructions={ws.parts.part2.instructions}>
      {ws.parts.part2.items.map((it) => {
        const ans = (ws.parts.part2.answers || {})[it.id] || { en: "", ja: "" };
        const m = (ws.parts.part2.marks || {})[it.id] || {};
        const enWrong = m.en === "wrong", enOk = m.en === "ok";
        const jaWrong = m.ja === "wrong", jaOk = m.ja === "ok";

        return (
          <div key={it.id} style={{ marginBottom: 12 }}>
            {/* 1行目：出題 */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              {mode === "trainer" ? (
                <DebouncedInput
                  className="input field-full"
                  value={it.prompt}
                  onChange={(v) => setWs((cur) => {
                    const items = cur.parts.part2.items;
                    const idx = items.findIndex((x) => x.id === it.id);
                    if (idx < 0) return cur;
                    const curVal = items[idx].prompt || "";
                    if (curVal === (v ?? "")) return cur;
                    const next = [...items]; next[idx] = { ...next[idx], prompt: v };
                    return { ...cur, parts: { ...cur.parts, part2: { ...cur.parts.part2, items: next } } };
                  })}
                  flushOnBlur={false}
                />
              ) : (
                <p style={{ margin: 0, lineHeight: 1.6, flex: 1 }}>{it.prompt}</p>
              )}
            </div>

            {/* 2行目：英語の答え＋採点 */}
            <div className="row" style={{ marginTop: 8 }}>
              <div className="flex-1">
                <DebouncedInput
                  className={`input field-full ${enWrong ? "answer-wrong" : ""} ${enOk ? "answer-correct" : ""}`}
                  placeholder="英語の答え（穴埋め）"
                  value={ans.en ?? ""}
                  onChange={(v) => {
                    draftRef.current.p2[it.id] = { ...(draftRef.current.p2[it.id] || ans), en: v };
                    scheduleFlush();
                  }}
                />
              </div>
              {mode === "trainer" && (
                <div className="mark-wrap">
                  <button
                    className="mark-btn ok"
                    onMouseDown={(e)=>e.preventDefault()}
                    onClick={() => setWs((c) => ({
                      ...c,
                      parts: {
                        ...c.parts,
                        part2: {
                          ...c.parts.part2,
                          marks: {
                            ...(c.parts.part2.marks || {}),
                            [it.id]: { ...((c.parts.part2.marks || {})[it.id]), en: "ok" }
                          }
                        }
                      }
                    }))}
                  >○</button>
                  <button
                    className="mark-btn wrong"
                    onMouseDown={(e)=>e.preventDefault()}
                    onClick={() => setWs((c) => ({
                      ...c,
                      parts: {
                        ...c.parts,
                        part2: {
                          ...c.parts.part2,
                          marks: {
                            ...(c.parts.part2.marks || {}),
                            [it.id]: { ...((c.parts.part2.marks || {})[it.id]), en: "wrong" }
                          }
                        }
                      }
                    }))}
                  >×</button>
                  <button
                    className="mark-btn clear"
                    onMouseDown={(e)=>e.preventDefault()}
                    onClick={() => setWs((c) => {
                      const base = { ...(c.parts.part2.marks || {}) };
                      const rec = { ...(base[it.id] || {}) };
                      delete rec.en;
                      base[it.id] = rec;
                      return { ...c, parts: { ...c.parts, part2: { ...c.parts.part2, marks: base } } };
                    })}
                  >消</button>
                </div>
              )}
            </div> {/* ← この閉じタグが抜けていた */}

            {/* 3行目：日本語訳＋採点 */}
            <div className="row" style={{ marginTop: 8 }}>
              <div className="flex-1">
                <DebouncedInput
                  className={`input field-full ${jaWrong ? "answer-wrong" : ""} ${jaOk ? "answer-correct" : ""}`}
                  placeholder="日本語訳"
                  value={ans.ja ?? ""}
                  onChange={(v) => {
                    draftRef.current.p2[it.id] = { ...(draftRef.current.p2[it.id] || ans), ja: v };
                    scheduleFlush();
                  }}
                />
              </div>
              {mode === "trainer" && (
                <div className="mark-wrap">
                  <button
                    className="mark-btn ok"
                    onMouseDown={(e)=>e.preventDefault()}
                    onClick={() => setWs((c) => ({
                      ...c,
                      parts: {
                        ...c.parts,
                        part2: {
                          ...c.parts.part2,
                          marks: {
                            ...(c.parts.part2.marks || {}),
                            [it.id]: { ...((c.parts.part2.marks || {})[it.id]), ja: "ok" }
                          }
                        }
                      }
                    }))}
                  >○</button>
                  <button
                    className="mark-btn wrong"
                    onMouseDown={(e)=>e.preventDefault()}
                    onClick={() => setWs((c) => ({
                      ...c,
                      parts: {
                        ...c.parts,
                        part2: {
                          ...c.parts.part2,
                          marks: {
                            ...(c.parts.part2.marks || {}),
                            [it.id]: { ...((c.parts.part2.marks || {})[it.id]), ja: "wrong" }
                          }
                        }
                      }
                    }))}
                  >×</button>
                  <button
                    className="mark-btn clear"
                    onMouseDown={(e)=>e.preventDefault()}
                    onClick={() => setWs((c) => {
                      const base = { ...(c.parts.part2.marks || {}) };
                      const rec = { ...(base[it.id] || {}) };
                      delete rec.ja;
                      base[it.id] = rec;
                      return { ...c, parts: { ...c.parts, part2: { ...c.parts.part2, marks: base } } };
                    })}
                  >消</button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* 講師コメント */}
      {mode === "trainer" ? (
        <div style={{ marginTop: 12 }}>
          <div className="label">講師コメント</div>
          <DebouncedInput
            multiline rows={3} autoGrow
            className="input field-full teacher-comment"
            value={ws.parts.part2.trainerNotes || ""}
            onChange={(v) =>
              setWs((cur) => ({
                ...cur,
                parts: { ...cur.parts, part2: { ...cur.parts.part2, trainerNotes: v } }
              }))
            }
          />
        </div>
      ) : ws.parts.part2.trainerNotes ? (
        <div style={{ marginTop: 12, background: "#f9fafb", borderLeft: "4px solid #e5e7eb", padding: "8px 12px", borderRadius: 8, color: "#b91c1c" }}>
          <strong>講師コメント：</strong><br />{ws.parts.part2.trainerNotes}
        </div>
      ) : null}
    </Card>
  );
});

// ====== Part3（トップレベル版）======
const Part3 = React.memo(function Part3({ Card, ws, setWs, mode, draftRef, scheduleFlush }) {
  return (
    <Card title={ws.parts.part3.label} instructions={ws.parts.part3.instructions}>
      {ws.parts.part3.items.map((it) => {
        const ans3Map = ws.parts.part3.answers || {};
        const m3 = (ws.parts.part3.marks || {})[it.id];
        const wrong3 = m3 === "wrong";
        const ok3 = m3 === "ok";

        const setMark3 = (val) =>
          setWs((c) => ({ ...c, parts: { ...c.parts, part3: { ...c.parts.part3, marks: { ...(c.parts.part3.marks || {}), [it.id]: val } } } }));
        const clearMark3 = () =>
          setWs((c) => { const m = { ...(c.parts.part3.marks || {}) }; delete m[it.id]; return { ...c, parts: { ...c.parts, part3: { ...c.parts.part3, marks: m } } }; });

        return (
          <div key={it.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                {mode === "trainer" ? (
                  <DebouncedInput
                    className="input field-full"
                    style={{ marginBottom: 6 }}
                    value={it.otherRole || ""}
                    placeholder="相手役の名前（例：Coworker）"
                    onChange={(v) => setWs((cur) => {
                      const items = cur.parts.part3.items;
                      const idx = items.findIndex((x) => x.id === it.id);
                      if (idx < 0) return cur;
                      const cv = items[idx].otherRole || "";
                      if (cv === (v ?? "")) return cur;
                      const next = [...items]; next[idx] = { ...next[idx], otherRole: v };
                      return { ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: next } } };
                    })}
                    flushOnBlur={false}
                  />
                ) : it.otherRole ? (
                  <div className="label" style={{ marginBottom: 6 }}>{it.otherRole}</div>
                ) : null}

                {mode === "trainer" ? (
                  <DebouncedInput
                    className="input field-full"
                    placeholder="相手の英語セリフ"
                    value={it.otherEn || ""}
                    onChange={(v) => setWs((cur) => {
                      const items = cur.parts.part3.items;
                      const idx = items.findIndex((x) => x.id === it.id);
                      if (idx < 0) return cur;
                      const cv = items[idx].otherEn || "";
                      if (cv === (v ?? "")) return cur;
                      const next = [...items]; next[idx] = { ...next[idx], otherEn: v };
                      return { ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: next } } };
                    })}
                    flushOnBlur={false}
                  />
                ) : (
                  <p style={{ margin: 0, lineHeight: 1.6 }}>{it.otherEn}</p>
                )}
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <div className="label">Masayuki</div>
              <div className="row">
                <div className="flex-1">
                  <DebouncedInput
                    multiline rows={2} autoGrow
                    className={`input field-full ${wrong3 ? "answer-wrong" : ""} ${ok3 ? "answer-correct" : ""}`}
                    placeholder="英語：ここに英訳を入力"
                    value={ans3Map[it.id] ?? ""}
                    onChange={(v) => { draftRef.current.p3[it.id] = v; scheduleFlush(); }}
                  />
                </div>
                {mode === "trainer" && (
                  <div className="mark-wrap">
                    <button className="mark-btn ok"    onMouseDown={(e)=>e.preventDefault()} …>○</button>
                    <button className="mark-btn wrong" onMouseDown={(e)=>e.preventDefault()} …>×</button>
                    <button className="mark-btn clear" onMouseDown={(e)=>e.preventDefault()} …>消</button>
                  </div>
                )}
              </div>

              <div className="label" style={{ marginTop: 8 }}>日本語</div>
              {mode === "trainer" ? (
                <DebouncedInput
                  multiline rows={2} autoGrow
                  className="input field-full"
                  value={it.jp || ""}
                  onChange={(v) => setWs((cur) => {
                    const items = cur.parts.part3.items;
                    const idx = items.findIndex((x) => x.id === it.id);
                    if (idx < 0) return cur;
                    const cv = items[idx].jp || "";
                    if (cv === (v ?? "")) return cur;
                    const next = [...items]; next[idx] = { ...next[idx], jp: v };
                    return { ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: next } } };
                  })}
                  flushOnBlur={false}
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
          <button className="btn btn-primary" 
            onMouseDown={(e)=>e.preventDefault()}
            onClick={() => setWs((cur) => ({
            ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: [...cur.parts.part3.items, { id: genId(), otherRole: "", otherEn: "", jp: "" }] } }
          }))}>セリフを追加</button>
        </div>
      )}

      {mode === "trainer" ? (
        <div style={{ marginTop: 12 }}>
          <div className="label">講師コメント</div>
          <DebouncedInput id="p3-notes" key="p3-notes" multiline rows={3} autoGrow className="input field-full teacher-comment"
            value={ws.parts.part3.trainerNotes || ""}
            onChange={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, trainerNotes: v } } }))} />
        </div>
      ) : ws.parts.part3.trainerNotes ? (
        <div style={{marginTop:12, background:'#f9fafb', borderLeft:'4px solid #e5e7eb', padding:'8px 12px', borderRadius:8, color:'#b91c1c'}}>
          <strong>講師コメント：</strong><br/>{ws.parts.part3.trainerNotes}
        </div>
      ) : null}
    </Card>
  );
});

/* ===================== Calendar helpers ===================== */
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
function listLocalTrainerDatesForUser(userId) {
  const prefix = `${LS_PREFIX}${userId}:`;
  const dates = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || "";
    if (!k.startsWith(prefix)) continue;
    try {
      const raw = localStorage.getItem(k);
      const obj = JSON.parse(raw || "{}");
      const p = obj?.parts || {};
      const hasMarks =
        (p.part1 && p.part1.marks && Object.keys(p.part1.marks).length) ||
        (p.part2 && p.part2.marks && Object.keys(p.part2.marks).length) ||
        (p.part3 && p.part3.marks && Object.keys(p.part3.marks).length);
      const hasNotes =
        (p.part1 && p.part1.trainerNotes) ||
        (p.part2 && p.part2.trainerNotes) ||
        (p.part3 && p.part3.trainerNotes) ||
        (obj && obj.trainerFeedback);
      if (hasMarks || hasNotes) {
        const d = k.substring(prefix.length, prefix.length + 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
      }
    } catch {}
  }
  return dates;
}

/* ===================== Data Model ===================== */
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
      items: [], answers: {}, marks: {}, trainerNotes: "" },
    part2: {
      label: "Part 2｜構文トレーニング（穴埋め＋日本語訳）",
      instructions: "Part1の語彙を使って文を完成させ、日本語訳も入力してください。",
      items: [], answers: {}, marks: {}, trainerNotes: "" },
    part3: {
      label: "Part 3｜会話ロールプレイ",
      instructions: "英文を入力して会話を完成させてください。",
      items: [], answers: {}, marks: {}, trainerNotes: "" },
    part4: { label: "Part 4｜英作文", instructions: "本日のテーマに沿って80–120語で英作文を作ろう。iPadは手書きも可（PNG保存）。", answer: "", handwriting: null, trainerNotes: "" },
  },
  trainerFeedback: "",
  submittedAt: null,
});

function ensureMaps(ws, curDate) {
  try {
    ws.parts.part1.answers = ws.parts.part1.answers || {};
    ws.parts.part1.marks   = ws.parts.part1.marks   || {};
    ws.parts.part2.answers = ws.parts.part2.answers || {};
    ws.parts.part2.marks   = ws.parts.part2.marks   || {};
    ws.parts.part3.answers = ws.parts.part3.answers || {};
    ws.parts.part3.marks   = ws.parts.part3.marks   || {};
  } catch (_) {
    ws = defaultWorksheet(curDate || todayISO());
  }
  if (ws?.meta) ws.meta.date = curDate || ws.meta.date || todayISO();
  return ws;
}
const nowISO = () => new Date().toISOString();

function snapshotLocal(userId, dateISO, ws) {
  try {
    const keyPrefix = `${LS_PREFIX}${userId}:${dateISO}:bak:`;
    const snapKey = keyPrefix + nowISO();
    localStorage.setItem(snapKey, JSON.stringify({ at: nowISO(), ws }));
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(keyPrefix)) keys.push(k);
    }
    keys.sort();
    while (keys.length > 5) localStorage.removeItem(keys.shift());
  } catch {}
}

/* ====== Merge (newer wins; Part2 per-field) ====== */
function newer(a, b) { return a && b ? (a > b ? a : b) : (a || b || null); }
function mergeWs(local, remote) {
  const out = JSON.parse(JSON.stringify(remote || local));

  // Part1 answers
  const l1a = local.parts.part1.answers || {}, r1a = remote.parts.part1.answers || {};
  const l1t = local.parts.part1.answersUpdatedAt || {}, r1t = remote.parts.part1.answersUpdatedAt || {};
  const m1a = { ...r1a }, m1t = { ...r1t };
  for (const id of new Set([...Object.keys(l1a), ...Object.keys(r1a)])) {
    const lt = l1t[id] || null, rt = r1t[id] || null;
    if ((lt && !rt) || (lt && rt && lt > rt)) { m1a[id] = l1a[id]; m1t[id] = lt; }
  }
  out.parts.part1.answers = m1a; out.parts.part1.answersUpdatedAt = m1t;

  // Part2 answers (per-field)
  const l2a = local.parts.part2.answers || {}, r2a = remote.parts.part2.answers || {};
  const l2t = local.parts.part2.answersUpdatedAt || {}, r2t = remote.parts.part2.answersUpdatedAt || {};
  const m2a = JSON.parse(JSON.stringify(r2a)), m2t = JSON.parse(JSON.stringify(r2t));
  for (const id of new Set([...Object.keys(l2a), ...Object.keys(r2a)])) {
    const lrec = l2a[id] || {}, rrec = r2a[id] || {};
    const lt = l2t[id] || {}, rt = r2t[id] || {};
    const enT = newer(lt.en, rt.en), jaT = newer(lt.ja, rt.ja);
    m2a[id] = { ...(m2a[id] || rrec) };
    m2t[id] = { ...(m2t[id] || rt) };
    if (enT === lt.en && lt.en) { m2a[id].en = lrec.en; m2t[id].en = lt.en; }
    if (jaT === lt.ja && lt.ja) { m2a[id].ja = lrec.ja; m2t[id].ja = lt.ja; }
  }
  out.parts.part2.answers = m2a; out.parts.part2.answersUpdatedAt = m2t;

  // Part3 answers
  const l3a = local.parts.part3.answers || {}, r3a = remote.parts.part3.answers || {};
  const l3t = local.parts.part3.answersUpdatedAt || {}, r3t = remote.parts.part3.answersUpdatedAt || {};
  const m3a = { ...r3a }, m3t = { ...r3t };
  for (const id of new Set([...Object.keys(l3a), ...Object.keys(r3a)])) {
    const lt = l3t[id] || null, rt = r3t[id] || null;
    if ((lt && !rt) || (lt && rt && lt > rt)) { m3a[id] = l3a[id]; m3t[id] = lt; }
  }
  out.parts.part3.answers = m3a; out.parts.part3.answersUpdatedAt = m3t;

  // submitted: keep any submitted
  out.submittedAt = remote.submittedAt || local.submittedAt || null;
  return out;
}

/* ===================== Calendar ===================== */
function MonthCalendar({ dateISO, onSelect, marked, submitted, trainer }) {
  const d = new Date(`${dateISO}T00:00:00`);
  const y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));

  return (
    <div className="card" style={{ padding: "12px", background: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <button className="btn" onClick={() => onSelect(todayISO(new Date(y, m - 1, 1)))}>◀</button>
        <div className="text-sm font-medium">{y}年{String(m + 1).padStart(2, "0")}月</div>
        <button className="btn" onClick={() => onSelect(todayISO(new Date(y, m + 1, 1)))}>▶</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center", fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
        {"月火水木金土日".split("").map((w) => <div key={w}>{w}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {days.map((dt) => {
          const iso = todayISO(dt);
          const inMonth = dt.getMonth() === m;
          const selected = iso === dateISO;
          const hasAny = marked.has(iso);
          const hasSubmit = submitted && submitted.has(iso);
          const hasTrainer = trainer && trainer.has(iso);
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              className="btn"
              style={{
                height: 36, borderRadius: 12, position: "relative",
                background: selected ? "black" : "white",
                color: selected ? "white" : "#111827",
                opacity: inMonth ? 1 : 0.45,
              }}
            >
              {String(dt.getDate())}
              {hasAny && (
                <span
                  className={`cal-dot ${hasTrainer ? "cal-trainer" : (hasSubmit ? "cal-submit" : "cal-any")}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ===================== Header ===================== */
const Header = React.memo(function Header({
  genre, dateISO, status, mode, pinInput, onPinChange,
  switchToTrainer, switchToStudent, showCal, setShowCal,
  doSync, submit, userId, markedDates, submittedDates, trainerDates,
  onPickDate, resetQuestions,
}) {
  return (
    <header className="sticky-header">
      <div className="header-bar">
        <div className="container">
          <div className="brand">
            <img src="/logo.png" alt="annetmii" className="header-logo"
              onError={(e) => { const s = document.createElement("span"); s.textContent = "annetmii"; e.currentTarget.replaceWith(s); }} />
            <h1 className="brand-title">annetmii English Camp</h1>
          </div>
        </div>
      </div>

      <div className="header-row">
        <div className="container">
          <div className="hstack">
            <button className="hdr-btn" 
              onMouseDown={(e)=>e.preventDefault()}
              onClick={(ev) => { ev.stopPropagation(); setShowCal((v) => !v); }}>カレンダー</button>
            {mode === "student" ? (
              <>
                <input type="password" inputMode="numeric" maxLength={4} className="pin-4ch" placeholder="PIN"
                       value={pinInput} onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ""))} aria-label="講師PIN" />
                <button className="hdr-btn-primary" 
                  onMouseDown={(e)=>e.preventDefault()}
                  onClick={(ev) => { ev.stopPropagation(); switchToTrainer(); }}>講師モード</button>
              </>
            ) : (
              <button className="hdr-btn" 
                onMouseDown={(e)=>e.preventDefault()}
                onClick={(ev) => { ev.stopPropagation(); switchToStudent(); }}>学習者モードへ</button>
            )}
          </div>
        </div>
      </div>

      <div className="header-row">
        <div className="container">
          <div className="hstack" style={{ justifyContent: "space-between" }}>
            <div className="hstack">
              <button className="hdr-btn-primary" onClick={(e) => { e.stopPropagation(); doSync("手動同期"); }}>同期</button>
              {mode === "trainer" && (
                <button className="hdr-btn danger-btn" onClick={(e) => { e.stopPropagation(); resetQuestions(); }} title="この日の出題を初期化">出題リセット</button>
              )}
              <button className="hdr-btn submit-btn" onClick={(e) => { e.stopPropagation(); submit(); }}>提出</button>
            </div>
            <span style={{ color: "#6b7280", fontSize: 13 }}>ステータス：{status}</span>
          </div>
        </div>
      </div>

      <div className="header-row">
        <div className="container">
          <div className="hdr-meta">{genre}｜{dateISO}</div>
        </div>
      </div>

      {showCal && (
        <div className="container" style={{ padding: "0 16px 12px" }} onClick={(e) => e.stopPropagation()}>
          <MonthCalendar
            dateISO={dateISO}
            onSelect={(iso) => { onPickDate(iso); }}
            marked={markedDates}
            submitted={submittedDates}
            trainer={trainerDates}
          />
        </div>
      )}
    </header>
  );
});

/* ===================== App ===================== */
export default function App() {
  const [userId] = useState("masayuki");
  const [dateISO, setDateISO] = useState(todayISO());
  const [mode, setMode] = useState("student");
  const [pinInput, setPinInput] = useState("");
  const [status, setStatus] = useState("準備完了");
  const [showCal, setShowCal] = useState(false);
  const [cloudDates, setCloudDates] = useState(new Set());

  const [ws, setWs] = useState(() => {
    const d = todayISO();
    const ls = localStorage.getItem(`${LS_PREFIX}${userId}:${d}`);
    return ensureMaps(ls ? JSON.parse(ls) : defaultWorksheet(d), d);
  });

  const genre = useMemo(() => DAY_GENRE[new Date(`${dateISO}T00:00:00`).getDay()], [dateISO]);

  useEffect(() => { window.__aec_setDate = (iso) => setDateISO(iso); return () => { delete window.__aec_setDate; }; }, []);

  /* ===== Local save (500ms + idle), always keyed by dateISO ===== */
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => idle(() => {
      try {
        const normalized = { ...ws, meta: { ...ws.meta, date: dateISO } };
        localStorage.setItem(`${LS_PREFIX}${userId}:${dateISO}`, JSON.stringify(normalized));
        snapshotLocal(userId, dateISO, normalized);
      } catch {}
    }), 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [ws, userId, dateISO]);

  /* ===== Load remote on start/date change ===== */
  useEffect(() => {
    (async () => {
      try {
        setStatus("クラウド読込中…");
        const remote = await cloudLoad({ userId, dateISO });
        if (remote && remote.data) {
          setWs(prev => mergeWs(
            ensureMaps(prev && prev.meta?.date === dateISO ? prev : defaultWorksheet(dateISO), dateISO),
            ensureMaps(remote.data, dateISO)
          ));
          setStatus("クラウドから読み込みました");
        } else {
          setWs(cur => (cur?.meta?.date === dateISO ? ensureMaps(cur, dateISO) : ensureMaps(defaultWorksheet(dateISO), dateISO)));
          setStatus("本日のワークシートを作成しました");
        }
      } catch {
        setStatus("オフライン：ローカル保存のみ");
      }
    })();
  }, [userId, dateISO]);

  /* ===== Calendar dots (cloud dates) ===== */
  const refreshCloudDates = useCallback(async () => {
    try { const res = await cloudListDates({ userId }); setCloudDates(new Set(res.dates || [])); } catch {}
  }, [userId]);
  useEffect(() => { refreshCloudDates(); }, [refreshCloudDates]);

  const markedDates = useMemo(() => {
    const set = new Set(listLocalDatesForUser(userId));
    cloudDates.forEach((d) => set.add(d));
    return set;
  }, [userId, cloudDates]);
  const submittedDates = useMemo(() => listLocalSubmittedDatesForUser(userId), [userId, ws]);
  const trainerDates = useMemo(() => listLocalTrainerDatesForUser(userId), [userId, ws]);

  /* ===== Batched input → ws (sets timestamps and status) ===== */
  const draftRef = useRef({ p1: {}, p2: {}, p3: {} });
  const flushTimerRef = useRef(null);
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      const d = draftRef.current; draftRef.current = { p1: {}, p2: {}, p3: {} };
      if (Object.keys(d.p1).length || Object.keys(d.p2).length || Object.keys(d.p3).length) {
        setStatus("変更あり（未同期）");
        setWs((cur) => {
          const ts = nowISO();
          const next = { ...cur, parts: { ...cur.parts } };

          if (Object.keys(d.p1).length) {
            const prevAns = cur.parts.part1.answers || {};
            const prevTs  = cur.parts.part1.answersUpdatedAt || {};
            const newAns = { ...prevAns };
            const newTs  = { ...prevTs };
            for (const id in d.p1) { newAns[id] = d.p1[id]; newTs[id] = ts; }
            next.parts.part1 = { ...cur.parts.part1, answers: newAns, answersUpdatedAt: newTs };
          }
          if (Object.keys(d.p2).length) {
            const prevAns = cur.parts.part2.answers || {};
            const prevTs  = cur.parts.part2.answersUpdatedAt || {};
            const newAns = { ...prevAns };
            const newTs  = { ...prevTs };
            for (const id in d.p2) {
              const prev = newAns[id] || { en: "", ja: "" };
              const patch = d.p2[id];
              newAns[id] = { ...prev, ...patch };
              newTs[id]  = { ...(prevTs[id] || {}), ...(Object.fromEntries(Object.keys(patch).map(k => [k, ts]))) };
            }
            next.parts.part2 = { ...cur.parts.part2, answers: newAns, answersUpdatedAt: newTs };
          }
          if (Object.keys(d.p3).length) {
            const prevAns = cur.parts.part3.answers || {};
            const prevTs  = cur.parts.part3.answersUpdatedAt || {};
            const newAns = { ...prevAns };
            const newTs  = { ...prevTs };
            for (const id in d.p3) { newAns[id] = d.p3[id]; newTs[id] = ts; }
            next.parts.part3 = { ...cur.parts.part3, answers: newAns, answersUpdatedAt: newTs };
          }
          return next;
        });
      }
      clearTimeout(flushTimerRef.current); flushTimerRef.current = null;
    }, 300);
  }, []);

  /* ===== 60s idle autosave to cloud ===== */
  const lastChangeRef = useRef(Date.now());
  useEffect(() => { lastChangeRef.current = Date.now(); }, [ws]);
  useEffect(() => {
    const id = setInterval(async () => {
      const idleFor = Date.now() - lastChangeRef.current;
      if (idleFor >= 60000) {
        try {
          setStatus("自動同期中…");
          await cloudSave({
            userId, dateISO,
            data: { ...ws, meta: { ...ws.meta, date: dateISO } },
            asTrainer: mode === "trainer", pin: mode === "trainer" ? pinInput : "",
          });
          setStatus("自動同期完了");
          refreshCloudDates();
        } catch {
          setStatus("自動同期失敗：後で再試行");
        }
        lastChangeRef.current = Date.now();
      }
    }, 5000);
    return () => clearInterval(id);
  }, [userId, dateISO, ws, mode, pinInput, refreshCloudDates]);

  /* ===== Trainer fast autosave (1.5s debounce) ===== */
  useEffect(() => {
    if (mode !== "trainer") return;
    const t = setTimeout(async () => {
      try {
        await cloudSave({
          userId, dateISO,
          data: { ...ws, meta: { ...ws.meta, date: dateISO } },
          asTrainer: true, pin: pinInput,
        });
        refreshCloudDates();
      } catch {}
    }, 1500);
    return () => clearTimeout(t);
  }, [ws, mode, userId, dateISO, pinInput, refreshCloudDates]);

  /* ===== Manual sync ===== */
  const doSync = useCallback(async (reason = "同期") => {
    try {
      setStatus(`${reason}中…`);
      await cloudSave({
        userId, dateISO,
        data: { ...ws, meta: { ...ws.meta, date: dateISO } },
        asTrainer: mode === "trainer", pin: mode === "trainer" ? pinInput : "",
      });
      setStatus(`${reason}完了`);
      refreshCloudDates();
    } catch {
      setStatus(`${reason}失敗：後で再試行`);
    }
  }, [userId, dateISO, ws, mode, pinInput, refreshCloudDates]);

  /* ===== Submit ===== */
  const submit = useCallback(() => {
    setWs((c) => ({ ...c, submittedAt: new Date().toISOString() }));
    doSync("提出");
  }, [doSync]);

  const switchToTrainer = useCallback(() => { if (pinInput === DEFAULT_PIN) setMode("trainer"); else alert("PINが違います。"); }, [pinInput]);
  const switchToStudent = useCallback(() => setMode("student"), []);

  /* ===== Fetch & merge loop (for other devices) ===== */
  const fetchAndMerge = useCallback(async () => {
    try {
      const remote = await cloudLoad({ userId, dateISO });
      if (remote && remote.data) {
        setWs((cur) => mergeWs(ensureMaps(cur, dateISO), ensureMaps(remote.data, dateISO)));
      }
    } catch {}
  }, [userId, dateISO]);
  useEffect(() => {
    const id = setInterval(fetchAndMerge, 10000);
    const onVis = () => { if (document.visibilityState === "visible") fetchAndMerge(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchAndMerge]);

  /* ===== Flush on unload/hidden ===== */
  useEffect(() => {
    const flushNow = () => {
      try {
        const normalized = { ...ws, meta: { ...ws.meta, date: dateISO } };
        localStorage.setItem(`${LS_PREFIX}${userId}:${dateISO}`, JSON.stringify(normalized));
        snapshotLocal(userId, dateISO, normalized);
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === "hidden") flushNow(); };
    window.addEventListener("beforeunload", flushNow);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("beforeunload", flushNow); document.removeEventListener("visibilitychange", onVis); };
  }, [userId, dateISO, ws]);

  /* ===== UI Shell ===== */
  const Card = ({ title, children, instructions }) => (
    <section className="container" style={{ padding: "12px 16px" }}>
      <div className="card">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>{title}</h2>
          {instructions ? <div className="label" style={{ lineHeight: 1.6 }}>{instructions}</div> : null}
        </div>
        <div className="content-pad">{children}</div>
      </div>
    </section>
  );

  const ThemeBar = React.memo(() => (
    <Card title="本日のテーマ">
      {mode === "trainer" ? (
        <DebouncedInput
          multiline rows={2} autoGrow className="input field-full theme-input"
          placeholder="Week 4｜Tuesday（Emergency）- ..."
          value={ws.meta.theme}
          onChange={(v) => setWs((cur) => ({ ...cur, meta: { ...cur.meta, theme: v } }))}
        />
      ) : (
        <p className="theme-text" style={{ margin: 0, whiteSpace: "pre-line" }}>
        {ws.meta.theme || "（未設定）"}</p>
      )}
    </Card>
  ));

  /* ===== Part 4 (writing) ===== */
  const Part4 = React.memo(() => (
  <Card title={ws.parts.part4.label} instructions={ws.parts.part4.instructions}>
    {/* 英作文テキスト（残す） */}
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

    {/* 講師コメントはそのまま（閲覧/編集） */}
    {mode === "trainer" ? (
      <div style={{ marginTop: 12 }}>
        <div className="label">講師コメント</div>
        <DebouncedInput
          id="p4-notes"
          key="p4-notes"
          multiline
          rows={3}
          autoGrow
          className="input field-full teacher-comment"
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
          color: "#b91c1c",
        }}
      >
        <strong>講師コメント：</strong>
        <br />
        {ws.parts.part4.trainerNotes}
      </div>
    ) : null}
  </Card>
));

  /* ===== Reset questions (trainer only) ===== */
  const resetQuestions = useCallback(() => {
    if (!window.confirm("この日の出題を初期状態に戻します。回答・採点・コメントも消えます。続行しますか？")) return;
    setWs((cur) => { const next = defaultWorksheet(cur.meta.date); next.meta.theme = cur.meta.theme || ""; return next; });
    setStatus("出題を初期化しました");
    doSync("出題リセット");
  }, [doSync]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(to bottom, #fff, #f9fafb)" }}>
      <Header
        genre={genre} dateISO={dateISO} status={status}
        mode={mode} pinInput={pinInput} onPinChange={setPinInput}
        switchToTrainer={() => { if (pinInput === DEFAULT_PIN) setMode("trainer"); else alert("PINが違います。"); }}
        switchToStudent={() => setMode("student")}
        showCal={showCal} setShowCal={setShowCal}
        doSync={doSync} submit={submit}
        userId={userId} markedDates={markedDates} submittedDates={submittedDates} trainerDates={trainerDates}
        onPickDate={(iso) => { setDateISO(iso); setShowCal(false); }}
        resetQuestions={resetQuestions}
      />
      <ThemeBar />
      <Part1  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={draftRef} scheduleFlush={scheduleFlush} />
      <Part2  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={draftRef} scheduleFlush={scheduleFlush} />
      <Part3  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={draftRef} scheduleFlush={scheduleFlush} />
      <Part4 />

      {mode === "trainer" ? (
        <section className="container" style={{ padding: "12px 16px" }}>
          <div className="card" style={{ padding: "16px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>全体フィードバック</h2>
            <DebouncedInput id="global-notes" key="global-notes" multiline rows={4} autoGrow className="input field-full teacher-comment"
              placeholder="今日のまとめコメントを入力" value={ws.trainerFeedback || ""}
              onChange={(v) => setWs((cur) => ({ ...cur, trainerFeedback: v }))} />
          </div>
        </section>
      ) : ws.trainerFeedback ? (
        <section className="container" style={{ padding: "12px 16px" }}>
          <div className="card" style={{ padding: "16px", background: "#f9fafb" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>講師フィードバック</h2>
            <p style={{ margin: 0, whiteSpace: "pre-line" }}>{ws.trainerFeedback}</p>
          </div>
        </section>
      ) : null}
      <footer className="container" style={{ padding: "32px 16px", textAlign: "center", fontSize: 12, color: "#6b7280" }}>©︎annetmii - 学習を習慣に</footer>
    </div>
  );
}
