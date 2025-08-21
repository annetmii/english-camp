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

/* =====================================================================
   DebouncedInput（Uncontrolled・確定コミット）
   - defaultValueで描画し、DOM値が唯一のソース
   - Blur / Enter / IME確定でだけ onCommit を呼ぶ（親state変更はこの時だけ）
   - フォーカス中は外部valueで上書きしない
===================================================================== */
const DebouncedInput = React.memo(function DebouncedInput({
  value,
  onDraft,
  onCommit,
  className = "",
  placeholder = "",
  multiline = false,
  rows = 1,
  autoGrow = true,
  commitOnEnter = true,
  ...rest
}) {
  const inputRef = useRef(null);
  const compRef = useRef(false);
  const focusedRef = useRef(false);
  const defaultValueRef = useRef(value ?? "");
  const editCountRef = useRef(0);

  useEffect(() => {
    return () => {
      if (editCountRef.current > 0) {
        window.__aecEditingCount = Math.max(0, (window.__aecEditingCount || 0) - editCountRef.current);
      }
    };
  }, []);

  const resize = (el) => {
    if (!autoGrow || !multiline || !el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 320) + "px";
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (multiline) resize(el);
    // フォーカス外なら外部値をDOMへ反映
    if (!focusedRef.current && !compRef.current) {
      const next = value ?? "";
      if (el.value !== next) {
        el.value = next;
        if (multiline) resize(el);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next) => { if (typeof onCommit === "function") onCommit(next); };

  const onFocus = () => {
    focusedRef.current = true;
    window.__aecEditingCount = (window.__aecEditingCount || 0) + 1;
    editCountRef.current += 1;
  };
  const onBlur = () => {
    focusedRef.current = false;
    const el = inputRef.current;
    if (el) commit(el.value);
    if (editCountRef.current > 0) {
      window.__aecEditingCount = Math.max(0, (window.__aecEditingCount || 0) - 1);
      editCountRef.current -= 1;
    }
  };

  const common = {
    ref: inputRef,
    className,
    placeholder,
    defaultValue: defaultValueRef.current,
    onChange: (e) => {
      if (multiline) resize(e.currentTarget);
      if (typeof onDraft === "function") onDraft(e.currentTarget.value);
    },
    onFocus,
    onBlur,
    onCompositionStart: () => { compRef.current = true; },
    onCompositionEnd: (e) => { compRef.current = false; if (!multiline) commit(e.currentTarget.value); },
    onKeyDown: (e) => {
      if (!multiline && commitOnEnter && e.key === "Enter") {
        e.preventDefault(); commit(e.currentTarget.value);
        try { e.currentTarget.blur(); } catch {}
      }
    },
    autoComplete: "off", autoCorrect: "off", spellCheck: false, inputMode: "text",
    enterKeyHint: "done", autoCapitalize: "none", ...rest,
  };

  if (!multiline) return <input {...common} />;
  return <textarea {...common} rows={rows} style={{ resize: "none", overflow: "hidden", ...(rest.style || {}) }} />;
});

/* ===================== Part1 ===================== */
const Part1Row = React.memo(function Part1Row({ it, ws, setWs, mode, draftRef }) {
  const answerMap = ws.parts.part1.answers || {};
  const answer = answerMap[it.id] ?? "";
  const mark = (ws.parts.part1.marks || {})[it.id];
  const isWrong = mark === "wrong";
  const isOk = mark === "ok";

  const setWord = (v) =>
    setWs((cur) => {
      const items = cur.parts.part1.items;
      const idx = items.findIndex((x) => x.id === it.id);
      if (idx < 0) return cur;
      const next = [...items]; next[idx] = { ...next[idx], en: v };
      return { ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, items: next } } };
    });

  const commitAnswer = (v) =>
    setWs((cur) => {
      const ts = new Date().toISOString();
      const a = cur.parts.part1.answers || {};
      const t = cur.parts.part1.answersUpdatedAt || {};
      return {
        ...cur, parts: { ...cur.parts, part1: {
          ...cur.parts.part1,
          answers: { ...a, [it.id]: v },
          answersUpdatedAt: { ...t, [it.id]: ts },
        } }
      };
    });

  const setMark = (val) =>
    setWs((cur) => ({
      ...cur,
      parts: { ...cur.parts, part1: { ...cur.parts.part1, marks: { ...(cur.parts.part1.marks || {}), [it.id]: val } } },
    }));
  const clearMark = () =>
    setWs((cur) => {
      const m = { ...(cur.parts.part1.marks || {}) }; delete m[it.id];
      return { ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, marks: m } } };
    });

  return (
    <div className="p1-row">
      {mode === "trainer" ? (
        <DebouncedInput className="input p1-word" value={it.en || ""} onCommit={setWord} />
      ) : (
        <span className="p1-word">{it.en}</span>
      )}

      {/* 日本語欄＋採点ボタンを1行に（PCで外枠内に収める） */}
      <div className="row" style={{ width: "100%" }}>
        <div className="flex-1">
          <DebouncedInput
            className={`input p1-answer ${isWrong ? "answer-wrong" : ""} ${isOk ? "answer-correct" : ""}`}
            placeholder="日本語訳"
            value={answer}
            onCommit={commitAnswer}
          />
        </div>
        {mode === "trainer" && (
          <div className="mark-wrap">
            <button type="button" className="mark-btn ok" onClick={() => setMark("ok")}>○</button>
            <button type="button" className="mark-btn wrong" onClick={() => setMark("wrong")}>×</button>
            <button type="button" className="mark-btn clear" onClick={clearMark}>消</button>
          </div>
        )}
      </div>
    </div>
  );
});

const Part1 = React.memo(function Part1({ Card, ws, setWs, mode, draftRef }) {
  return (
    <Card title={ws.parts.part1.label} instructions={ws.parts.part1.instructions}>
      <div className="grid1">
        {ws.parts.part1.items.map((it) => (
          <Part1Row key={it.id} it={it} mode={mode} ws={ws} setWs={setWs} draftRef={draftRef} />
        ))}
      </div>
      {mode === "trainer" && (
        <div style={{ paddingTop: 8, display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary"
            onClick={() => setWs((cur) => ({
              ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, items: [...cur.parts.part1.items, { id: genId(), en: "" }] } }
            }))}
          >語彙を追加</button>
        </div>
      )}
      {mode === "trainer" ? (
        <div style={{ marginTop: 12 }}>
          <div className="label">講師コメント</div>
          <DebouncedInput
            multiline rows={3} autoGrow className="input field-full teacher-comment"
            value={ws.parts.part1.trainerNotes || ""}
            onCommit={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, trainerNotes: v } } }))}
          />
        </div>
      ) : ws.parts.part1.trainerNotes ? (
        <div className="teacher-note"><strong>講師コメント：</strong><br/>{ws.parts.part1.trainerNotes}</div>
      ) : null}
    </Card>
  );
});

/* ===================== Part2 ===================== */
const Part2 = React.memo(function Part2({ Card, ws, setWs, mode, draftRef }) {
  return (
    <Card title={ws.parts.part2.label} instructions={ws.parts.part2.instructions}>
      {ws.parts.part2.items.map((it) => {
        const ans = (ws.parts.part2.answers || {})[it.id] || { en: "", ja: "" };
        const m = (ws.parts.part2.marks || {})[it.id] || {};
        const enWrong = m.en === "wrong", enOk = m.en === "ok";
        const jaWrong = m.ja === "wrong", jaOk = m.ja === "ok";

        const commitField = (patch) => setWs((cur) => {
          const ts = new Date().toISOString();
          const prevAns = cur.parts.part2.answers || {};
          const prevTs  = cur.parts.part2.answersUpdatedAt || {};
          const prevRec = prevAns[it.id] || { en: "", ja: "" };
          const newRec = { ...prevRec, ...patch };
          const tsPatch = Object.fromEntries(Object.keys(patch).map(k => [k, ts]));
          return {
            ...cur, parts: { ...cur.parts, part2: {
              ...cur.parts.part2,
              answers: { ...prevAns, [it.id]: newRec },
              answersUpdatedAt: { ...prevTs, [it.id]: { ...(prevTs[it.id] || {}), ...tsPatch } }
            } }
          };
        });

        return (
          <div key={it.id} style={{ marginBottom: 12 }}>
            {/* 出題 */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              {mode === "trainer" ? (
                <DebouncedInput
                  className="input field-full"
                  value={it.prompt || ""}
                  onCommit={(v) => setWs((cur) => {
                    const items = cur.parts.part2.items;
                    const idx = items.findIndex((x) => x.id === it.id);
                    if (idx < 0) return cur;
                    const next = [...items]; next[idx] = { ...next[idx], prompt: v };
                    return { ...cur, parts: { ...cur.parts, part2: { ...cur.parts.part2, items: next } } };
                  })}
                />
              ) : (
                <p style={{ margin: 0, lineHeight: 1.6, flex: 1 }}>{it.prompt}</p>
              )}
            </div>

            {/* 英語の答え */}
            <div className="row" style={{ marginTop: 8 }}>
              <div className="flex-1">
                <DebouncedInput
                  className={`input field-full ${enWrong ? "answer-wrong" : ""} ${enOk ? "answer-correct" : ""}`}
                  placeholder="英語の答え（穴埋め）"
                  value={ans.en ?? ""}
                  onDraft={(v) => { draftRef.current.p2[it.id] = { ...(draftRef.current.p2[it.id] || ans), en: v }; }}
                  onCommit={(v) => commitField({ en: v })}
                />
              </div>
              {mode === "trainer" && (
                <div className="mark-wrap">
                  <button type="button" className="mark-btn ok"
                    onClick={() => setWs((c) => ({
                      ...c, parts: { ...c.parts, part2: { ...c.parts.part2,
                        marks: { ...(c.parts.part2.marks || {}), [it.id]: { ...((c.parts.part2.marks || {})[it.id]), en: "ok" } } } }
                    }))}>○</button>
                  <button type="button" className="mark-btn wrong"
                    onClick={() => setWs((c) => ({
                      ...c, parts: { ...c.parts, part2: { ...c.parts.part2,
                        marks: { ...(c.parts.part2.marks || {}), [it.id]: { ...((c.parts.part2.marks || {})[it.id]), en: "wrong" } } } }
                    }))}>×</button>
                  <button type="button" className="mark-btn clear"
                    onClick={() => setWs((c) => {
                      const base = { ...(c.parts.part2.marks || {}) }; const rec = { ...(base[it.id] || {}) };
                      delete rec.en; base[it.id] = rec;
                      return { ...c, parts: { ...c.parts, part2: { ...c.parts.part2, marks: base } } };
                    })}>消</button>
                </div>
              )}
            </div>

            {/* 日本語訳 */}
            <div className="row" style={{ marginTop: 8 }}>
              <div className="flex-1">
                <DebouncedInput
                  className={`input field-full ${jaWrong ? "answer-wrong" : ""} ${jaOk ? "answer-correct" : ""}`}
                  placeholder="日本語訳"
                  value={ans.ja ?? ""}
                  onDraft={(v) => { draftRef.current.p2[it.id] = { ...(draftRef.current.p2[it.id] || ans), ja: v }; }}
                  onCommit={(v) => commitField({ ja: v })}
                />
              </div>
              {mode === "trainer" && (
                <div className="mark-wrap">
                  <button type="button" className="mark-btn ok"
                    onClick={() => setWs((c) => ({
                      ...c, parts: { ...c.parts, part2: { ...c.parts.part2,
                        marks: { ...(c.parts.part2.marks || {}), [it.id]: { ...((c.parts.part2.marks || {})[it.id]), ja: "ok" } } } }
                    }))}>○</button>
                  <button type="button" className="mark-btn wrong"
                    onClick={() => setWs((c) => ({
                      ...c, parts: { ...c.parts, part2: { ...c.parts.part2,
                        marks: { ...(c.parts.part2.marks || {}), [it.id]: { ...((c.parts.part2.marks || {})[it.id]), ja: "wrong" } } } }
                    }))}>×</button>
                  <button type="button" className="mark-btn clear"
                    onClick={() => setWs((c) => {
                      const base = { ...(c.parts.part2.marks || {}) }; const rec = { ...(base[it.id] || {}) };
                      delete rec.ja; base[it.id] = rec;
                      return { ...c, parts: { ...c.parts, part2: { ...c.parts.part2, marks: base } } };
                    })}>消</button>
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
            multiline rows={3} autoGrow className="input field-full teacher-comment"
            value={ws.parts.part2.trainerNotes || ""}
            onCommit={(v) => setWs((cur) => ({
              ...cur, parts: { ...cur.parts, part2: { ...cur.parts.part2, trainerNotes: v } }
            }))}
          />
        </div>
      ) : ws.parts.part2.trainerNotes ? (
        <div className="teacher-note"><strong>講師コメント：</strong><br />{ws.parts.part2.trainerNotes}</div>
      ) : null}
    </Card>
  );
});

/* ===================== Part3 ===================== */
const Part3 = React.memo(function Part3({ Card, ws, setWs, mode, draftRef }) {
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
                    onCommit={(v) => setWs((cur) => {
                      const items = cur.parts.part3.items;
                      const idx = items.findIndex((x) => x.id === it.id);
                      if (idx < 0) return cur;
                      const next = [...items]; next[idx] = { ...next[idx], otherRole: v };
                      return { ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: next } } };
                    })}
                  />
                ) : it.otherRole ? (
                  <div className="label" style={{ marginBottom: 6 }}>{it.otherRole}</div>
                ) : null}

                {mode === "trainer" ? (
                  <DebouncedInput
                    className="input field-full"
                    placeholder="相手の英語セリフ"
                    value={it.otherEn || ""}
                    onCommit={(v) => setWs((cur) => {
                      const items = cur.parts.part3.items;
                      const idx = items.findIndex((x) => x.id === it.id);
                      if (idx < 0) return cur;
                      const next = [...items]; next[idx] = { ...next[idx], otherEn: v };
                      return { ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: next } } };
                    })}
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
                    onDraft={(v) => { draftRef.current.p3[it.id] = v; }}
                    onCommit={(v) => setWs((cur) => {
                      const ts = new Date().toISOString();
                      const prevAns = cur.parts.part3.answers || {};
                      const prevTs  = cur.parts.part3.answersUpdatedAt || {};
                      return {
                        ...cur, parts: { ...cur.parts, part3: {
                          ...cur.parts.part3,
                          answers: { ...prevAns, [it.id]: v },
                          answersUpdatedAt: { ...prevTs, [it.id]: ts },
                        } }
                      };
                    })}
                  />
                </div>
                {mode === "trainer" && (
                  <div className="mark-wrap">
                    <button type="button" className="mark-btn ok"    onClick={() => setMark3("ok")}>○</button>
                    <button type="button" className="mark-btn wrong" onClick={() => setMark3("wrong")}>×</button>
                    <button type="button" className="mark-btn clear" onClick={clearMark3}>消</button>
                  </div>
                )}
              </div>

              <div className="label" style={{ marginTop: 8 }}>日本語</div>
              {mode === "trainer" ? (
                <DebouncedInput
                  multiline rows={2} autoGrow
                  className="input field-full"
                  value={it.jp || ""}
                  onCommit={(v) => setWs((cur) => {
                    const items = cur.parts.part3.items;
                    const idx = items.findIndex((x) => x.id === it.id);
                    if (idx < 0) return cur;
                    const next = [...items]; next[idx] = { ...next[idx], jp: v };
                    return { ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: next } } };
                  })}
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
          <button type="button" className="btn btn-primary"
            onClick={() => setWs((cur) => ({
              ...cur, parts: { ...cur.parts, part3: { ...cur.parts.part3, items: [...cur.parts.part3.items, { id: genId(), otherRole: "", otherEn: "", jp: "" }] } }
            }))}
          >セリフを追加</button>
        </div>
      )}
    </Card>
  );
});

/* ===================== Part4（Writing） ===================== */
const Part4 = React.memo(function Part4({ Card, ws, setWs, mode }) {
  return (
    <Card title={ws.parts.part4.label} instructions={ws.parts.part4.instructions}>
      <DebouncedInput
        multiline rows={3} autoGrow className="input field-full"
        placeholder="ここに英作文を入力してください"
        value={ws.parts.part4.answer || ""}
        onCommit={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part4: { ...cur.parts.part4, answer: v } } }))}
      />
      {mode === "trainer" ? (
        <div style={{ marginTop: 12 }}>
          <div className="label">講師コメント</div>
          <DebouncedInput
            multiline rows={3} autoGrow className="input field-full teacher-comment"
            value={ws.parts.part4.trainerNotes || ""}
            onCommit={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part4: { ...cur.parts.part4, trainerNotes: v } } }))}
          />
        </div>
      ) : ws.parts.part4.trainerNotes ? (
        <div style={{ marginTop: 12, background: "#f9fafb", borderLeft: "4px solid #e5e7eb", padding: "8px 12px", borderRadius: 8, color: "#b91c1c" }}>
          <strong>講師コメント：</strong><br />{ws.parts.part4.trainerNotes}
        </div>
      ) : null}
    </Card>
  );
});

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
              {hasAny && <span className={`cal-dot ${hasTrainer ? "cal-trainer" : (hasSubmit ? "cal-submit" : "cal-any")}`} />}
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
            <button className="hdr-btn" onClick={() => setShowCal((v) => !v)}>カレンダー</button>
            {mode === "student" ? (
              <>
                <input type="password" inputMode="numeric" maxLength={4} className="pin-4ch" placeholder="PIN"
                       value={pinInput} onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ""))} aria-label="講師PIN" />
                <button className="hdr-btn-primary" onClick={switchToTrainer}>講師モード</button>
              </>
            ) : (
              <button className="hdr-btn" onClick={switchToStudent}>学習者モードへ</button>
            )}
          </div>
        </div>
      </div>

      <div className="header-row">
        <div className="container">
          <div className="hstack" style={{ justifyContent: "space-between" }}>
            <div className="hstack">
              <button className="hdr-btn-primary" onClick={() => doSync("手動同期")}>同期</button>
              {mode === "trainer" && (
                <button className="hdr-btn danger-btn" onClick={resetQuestions} title="この日の出題を初期化">出題リセット</button>
              )}
              <button className="hdr-btn submit-btn" onClick={submit}>提出</button>
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
        <div className="container" style={{ padding: "0 16px 12px" }}>
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

/* ===================== Data Model ===================== */
const defaultWorksheet = (dateISO) => ({
  meta: { app: "annetmii-english-camp", version: 43, date: dateISO, genre: DAY_GENRE[new Date(dateISO + "T00:00:00").getDay()], trainee: "Masayuki", theme: "" },
  parts: {
    part1: { label: "Part 1｜語彙チェック（英単語→日本語訳）", instructions: "英単語の日本語訳を入力してください。", items: [], answers: {}, marks: {}, trainerNotes: "" },
    part2: { label: "Part 2｜構文トレーニング（穴埋め＋日本語訳）", instructions: "Part1の語彙を使って文を完成させ、日本語訳も入力してください。", items: [], answers: {}, marks: {}, trainerNotes: "" },
    part3: { label: "Part 3｜会話ロールプレイ", instructions: "英文を入力して会話を完成させてください。", items: [], answers: {}, marks: {}, trainerNotes: "" },
    part4: { label: "Part 4｜英作文", instructions: "本日のテーマに沿って80–120語で英作文を作ろう。", answer: "", handwriting: null, trainerNotes: "" },
  },
  trainerFeedback: "", submittedAt: null,
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
        (p.part1 && p.part1.trainerNotes) || (p.part2 && p.part2.trainerNotes) ||
        (p.part3 && p.part3.trainerNotes) || (obj && obj.trainerFeedback);
      if (hasMarks || hasNotes) {
        const d = k.substring(prefix.length, prefix.length + 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
      }
    } catch {}
  }
  return dates;
}

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

  /* Local save */
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => idle(() => {
      try {
        const normalized = { ...ws, meta: { ...ws.meta, date: dateISO } };
        localStorage.setItem(`${LS_PREFIX}${userId}:${dateISO}`, JSON.stringify(normalized));
      } catch {}
    }), 600);
    return () => clearTimeout(saveTimerRef.current);
  }, [ws, userId, dateISO]);

  /* Load remote */
  useEffect(() => {
    (async () => {
      try {
        setStatus("クラウド読込中…");
        const remote = await cloudLoad({ userId, dateISO });
        if (remote && remote.data) {
          setWs(ensureMaps(remote.data, dateISO));
          setStatus("クラウドから読み込みました");
        } else {
          setWs(ensureMaps(defaultWorksheet(dateISO), dateISO));
          setStatus("本日のワークシートを作成しました");
        }
      } catch {
        setStatus("オフライン：ローカル保存のみ");
      }
    })();
  }, [userId, dateISO]);

  /* Calendar dots */
  const refreshCloudDates = useCallback(async () => {
    try { const res = await cloudListDates({ userId }); setCloudDates(new Set(res.dates || [])); } catch {}
  }, [userId]);
  useEffect(() => { refreshCloudDates(); }, [refreshCloudDates]);

  const markedDates = useMemo(() => { const set = new Set(listLocalDatesForUser(userId)); cloudDates.forEach((d) => set.add(d)); return set; }, [userId, cloudDates]);
  const submittedDates = useMemo(() => listLocalSubmittedDatesForUser(userId), [userId, ws]);
  const trainerDates = useMemo(() => listLocalTrainerDatesForUser(userId), [userId, ws]);

  /* Idle autosave to cloud */
  const lastChangeRef = useRef(Date.now());
  useEffect(() => { lastChangeRef.current = Date.now(); }, [ws]);
  useEffect(() => {
    const id = setInterval(async () => {
      const idleFor = Date.now() - lastChangeRef.current;
      if (idleFor >= 60000 && (window.__aecEditingCount || 0) === 0) {
        try {
          setStatus("自動同期中…");
          await cloudSave({
            userId, dateISO, data: { ...ws, meta: { ...ws.meta, date: dateISO } },
            asTrainer: mode === "trainer", pin: mode === "trainer" ? pinInput : "",
          });
          setStatus("自動同期完了");
          refreshCloudDates();
        } catch { setStatus("自動同期失敗：後で再試行"); }
        lastChangeRef.current = Date.now();
      }
    }, 5000);
    return () => clearInterval(id);
  }, [userId, dateISO, ws, mode, pinInput, refreshCloudDates]);

  /* Trainer fast autosave */
  useEffect(() => {
    if (mode !== "trainer") return;
    if ((window.__aecEditingCount || 0) > 0) return;
    const t = setTimeout(async () => {
      try {
        await cloudSave({ userId, dateISO, data: { ...ws, meta: { ...ws.meta, date: dateISO } }, asTrainer: true, pin: pinInput });
        refreshCloudDates();
      } catch {}
    }, 1500);
    return () => clearTimeout(t);
  }, [ws, mode, userId, dateISO, pinInput, refreshCloudDates]);

  /* Manual sync */
  const doSync = useCallback(async (reason = "同期") => {
    if ((window.__aecEditingCount || 0) > 0) { setStatus("編集中のため同期を保留"); return; }
    try {
      setStatus(`${reason}中…`);
      await cloudSave({ userId, dateISO, data: { ...ws, meta: { ...ws.meta, date: dateISO } }, asTrainer: mode === "trainer", pin: mode === "trainer" ? pinInput : "" });
      setStatus(`${reason}完了`);
      refreshCloudDates();
    } catch { setStatus(`${reason}失敗：後で再試行`); }
  }, [userId, dateISO, ws, mode, pinInput, refreshCloudDates]);

  /* Submit */
  const submit = useCallback(() => {
    setWs((c) => ({ ...c, submittedAt: nowISO() }));
    doSync("提出");
  }, [doSync]);

  /* Mode switch */
  const switchToTrainer = useCallback(() => { if (pinInput === DEFAULT_PIN) setMode("trainer"); else alert("PINが違います。"); }, [pinInput]);
  const switchToStudent = useCallback(() => setMode("student"), []);

  /* Fetch & merge from remote (paused while editing) */
  const fetchAndMerge = useCallback(async () => {
    try {
      if ((window.__aecEditingCount || 0) > 0) return;
      const remote = await cloudLoad({ userId, dateISO });
      if (remote && remote.data) setWs(ensureMaps(remote.data, dateISO));
    } catch {}
  }, [userId, dateISO]);
  useEffect(() => {
    const id = setInterval(fetchAndMerge, 10000);
    const onVis = () => { if (document.visibilityState === "visible") fetchAndMerge(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchAndMerge]);

  /* Flush on unload/hidden */
  useEffect(() => {
    const flushNow = () => {
      try {
        const normalized = { ...ws, meta: { ...ws.meta, date: dateISO } };
        localStorage.setItem(`${LS_PREFIX}${userId}:${dateISO}`, JSON.stringify(normalized));
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === "hidden") flushNow(); };
    window.addEventListener("beforeunload", flushNow);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("beforeunload", flushNow); document.removeEventListener("visibilitychange", onVis); };
  }, [userId, dateISO, ws]);

  /* UI Shell */
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

  const HeaderBar = React.memo(() => (
    <Header
      genre={genre} dateISO={dateISO} status={status}
      mode={mode} pinInput={pinInput} onPinChange={setPinInput}
      switchToTrainer={switchToTrainer} switchToStudent={switchToStudent}
      showCal={showCal} setShowCal={setShowCal}
      doSync={doSync} submit={submit}
      userId={userId} markedDates={markedDates} submittedDates={submittedDates} trainerDates={trainerDates}
      onPickDate={(iso) => { setDateISO(iso); setShowCal(false); }}
      resetQuestions={() => {
        if (!window.confirm("この日の出題を初期状態に戻します。回答・採点・コメントも消えます。続行しますか？")) return;
        setWs((cur) => { const next = defaultWorksheet(cur.meta.date); next.meta.theme = cur.meta.theme || ""; return next; });
        setStatus("出題を初期化しました");
        doSync("出題リセット");
      }}
    />
  ));

  const ThemeBar = React.memo(() => (
    <Card title="本日のテーマ">
      {mode === "trainer" ? (
        <DebouncedInput
          multiline rows={2} autoGrow className="input field-full theme-input"
          placeholder="Week 4｜Tuesday（Emergency）- ..."
          value={ws.meta.theme} onCommit={(v) => setWs((cur) => ({ ...cur, meta: { ...cur.meta, theme: v } }))}
        />
      ) : (
        <p className="theme-text" style={{ margin: 0, whiteSpace: "pre-line" }}>
          {ws.meta.theme || "（未設定）"}
        </p>
      )}
    </Card>
  ));

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(to bottom, #fff, #f9fafb)" }}>
      <HeaderBar />
      <ThemeBar />
      <Part1  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={{ current: { p1: {}, p2: {}, p3: {} } }} />
      <Part2  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={{ current: { p1: {}, p2: {}, p3: {} } }} />
      <Part3  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={{ current: { p1: {}, p2: {}, p3: {} } }} />
      <Part4  Card={Card} ws={ws} setWs={setWs} mode={mode} />
      <section className="container" style={{ padding: "12px 16px" }}>
        {mode === "trainer" ? (
          <div className="card" style={{ padding: "16px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>全体フィードバック</h2>
            <DebouncedInput id="global-notes" key="global-notes"
              multiline rows={4} autoGrow className="input field-full teacher-comment"
              placeholder="今日のまとめコメントを入力" value={ws.trainerFeedback || ""}
              onCommit={(v) => setWs((cur) => ({ ...cur, trainerFeedback: v }))}
            />
          </div>
        ) : ws.trainerFeedback ? (
          <div className="card" style={{ padding: "16px", background: "#f9fafb" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>講師フィードバック</h2>
            <p style={{ margin: 0, whiteSpace: "pre-line" }}>{ws.trainerFeedback}</p>
          </div>
        ) : null}
      </section>
      <footer className="container" style={{ padding: "32px 16px", textAlign: "center", fontSize: 12, color: "#6b7280" }}>©︎annetmii - Make Every Day Yours</footer>
    </div>
  );
}
