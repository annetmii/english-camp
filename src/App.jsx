// /src/App.jsx
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

/* ===================== DebouncedInput: 確定コミット型 ===================== */
/**
 * 役割を分離：
 * - onDraft: 打鍵ごとに呼ばれる（親stateは触らない）
 * - onCommit: Blur/Enterなど「確定」時だけ呼ぶ（ここで親にsetWs）
 * これにより、入力中は親が再レンダーせずフォーカスが飛ばない。
 */
const DebouncedInput = React.memo(function DebouncedInput({
  value,
  onDraft,                 // ★変更: 打鍵ごと（親stateに触らない想定）
  onCommit,                // ★変更: 確定時のみ親へ反映（setWsはここだけ）
  className = "",
  placeholder = "",
  multiline = false,
  rows = 1,
  autoGrow = true,
  commitOnEnter = true,    // ★変更: Enter確定（textareaは改行優先）
  ...rest
}) {
  const [inner, setInner] = useState(value ?? "");
  const compRef = useRef(false);
  const inputRef = useRef(null);
  const focusedRef = useRef(false);

  // 親→子 同期（フォーカス中・IME中は上書きしない）
  useEffect(() => {
    if (compRef.current || focusedRef.current) return;
    setInner(value ?? "");
  }, [value]);

  // autosize
  const resize = useCallback(() => {
    if (!autoGrow || !multiline || !inputRef.current) return;
    const el = inputRef.current;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 320) + "px";
  }, [autoGrow, multiline]);
  useEffect(() => { resize(); }, [inner, resize]);

  const commit = useCallback((next) => {
    if (typeof onCommit === "function") onCommit(next);
  }, [onCommit]);

  const common = {
    ref: inputRef,
    className,
    placeholder,
    value: inner,
    onChange: (e) => {
      const v = e.target.value;
      setInner(v);
      if (typeof onDraft === "function") onDraft(v);
    },
    onFocus: () => { focusedRef.current = true; },
    onBlur: () => {
      focusedRef.current = false;
      commit(inner);       // ★変更: Blurで確定コミット
    },
    onCompositionStart: () => { compRef.current = true; },
    onCompositionEnd: (e) => {
      compRef.current = false;
      const v = e.currentTarget.value;
      setInner(v);
      if (!multiline) commit(v); // 単行はIME確定でもコミット
    },
    onKeyDown: (e) => {
      if (!commitOnEnter) return;
      if (!multiline && e.key === "Enter") {
        e.preventDefault();
        commit(inner);     // ★変更: Enterで確定
        try { e.currentTarget.blur(); } catch {}
      }
    },
    autoComplete: "off",
    autoCorrect: "off",
    spellCheck: false,
    inputMode: "text",
    enterKeyHint: "done",
    autoCapitalize: "none",
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

/* ====== Part1Row ====== */
const Part1Row = React.memo(function Part1Row({ it, ws, setWs, mode, draftRef }) {
  const answerMap = ws.parts.part1.answers || {};
  const answer = answerMap[it.id] ?? "";
  const mark = (ws.parts.part1.marks || {})[it.id];
  const isWrong = mark === "wrong";
  const isOk = mark === "ok";

  const onChangeWord = (v) =>
    setWs((cur) => {
      const items = cur.parts.part1.items;
      const idx = items.findIndex((x) => x.id === it.id);
      if (idx < 0) return cur;
      const cv = items[idx].en || "";
      if (cv === (v ?? "")) return cur;
      const next = [...items]; next[idx] = { ...next[idx], en: v };
      return { ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, items: next } } };
    });

  // ★変更: 打鍵中はdraftRefだけ更新。親へのsetWsはcommit時のみ。
  const onDraftAnswer = (v) => { draftRef.current.p1[it.id] = v; };
  const onCommitAnswer = (v) => {
    setWs((cur) => {
      const ts = new Date().toISOString();
      const prevAns = cur.parts.part1.answers || {};
      const prevTs  = cur.parts.part1.answersUpdatedAt || {};
      return {
        ...cur,
        parts: {
          ...cur.parts,
          part1: {
            ...cur.parts.part1,
            answers: { ...prevAns, [it.id]: v },
            answersUpdatedAt: { ...prevTs, [it.id]: ts },
          },
        },
      };
    });
  };

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
          onDraft={onChangeWord}
          onCommit={onChangeWord}
        />
      ) : (
        <span className="p1-word">{it.en}</span>
      )}

      <DebouncedInput
        className={`input p1-answer ${isWrong ? "answer-wrong" : ""} ${isOk ? "answer-correct" : ""}`}
        placeholder="日本語訳"
        value={answer}
        onDraft={onDraftAnswer}      // ★変更: 打鍵→draftのみ
        onCommit={onCommitAnswer}    // ★変更: 確定時だけ親に反映
      />

      {mode === "trainer" && (
        <div className="mark-wrap">
          <button type="button" className="mark-btn ok" onClick={() => setMark("ok")}>○</button>
          <button type="button" className="mark-btn wrong" onClick={() => setMark("wrong")}>×</button>
          <button type="button" className="mark-btn clear" onClick={clearMark}>消</button>
        </div>
      )}
    </div>
  );
});

/* ====== Part1 ====== */
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
              ...cur,
              parts: { ...cur.parts, part1: { ...cur.parts.part1, items: [...cur.parts.part1.items, { id: genId(), en: "" }] } }
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
            onDraft={(v) => v}
            onCommit={(v) => setWs((cur) => ({ ...cur, parts: { ...cur.parts, part1: { ...cur.parts.part1, trainerNotes: v } } }))}
          />
        </div>
      ) : ws.parts.part1.trainerNotes ? (
        <div className="teacher-note"> <strong>講師コメント：</strong><br/>{ws.parts.part1.trainerNotes} </div>
      ) : null}
    </Card>
  );
});

/* ====== Part2 ====== */
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
            ...cur,
            parts: {
              ...cur.parts,
              part2: {
                ...cur.parts.part2,
                answers: { ...prevAns, [it.id]: newRec },
                answersUpdatedAt: { ...prevTs, [it.id]: { ...(prevTs[it.id] || {}), ...tsPatch } }
              }
            }
          };
        });

        return (
          <div key={it.id} style={{ marginBottom: 12 }}>
            {/* 1行目：出題 */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              {mode === "trainer" ? (
                <DebouncedInput
                  className="input field-full"
                  value={it.prompt}
                  onDraft={(v)=>v}
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

            {/* 2行目：英語の答え */}
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
                      ...c,
                      parts: { ...c.parts, part2: { ...c.parts.part2,
                        marks: { ...(c.parts.part2.marks || {}), [it.id]:
                          { ...((c.parts.part2.marks || {})[it.id]), en: "ok" } } } }
                    }))}
                  >○</button>
                  <button type="button" className="mark-btn wrong"
                    onClick={() => setWs((c) => ({
                      ...c,
                      parts: { ...c.parts, part2: { ...c.parts.part2,
                        marks: { ...(c.parts.part2.marks || {}), [it.id]:
                          { ...((c.parts.part2.marks || {})[it.id]), en: "wrong" } } } }
                    }))}
                  >×</button>
                  <button type="button" className="mark-btn clear"
                    onClick={() => setWs((c) => {
                      const base = { ...(c.parts.part2.marks || {}) };
                      const rec = { ...(base[it.id] || {}) };
                      delete rec.en; base[it.id] = rec;
                      return { ...c, parts: { ...c.parts, part2: { ...c.parts.part2, marks: base } } };
                    })}
                  >消</button>
                </div>
              )}
            </div>

            {/* 3行目：日本語訳 */}
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
                      ...c,
                      parts: { ...c.parts, part2: { ...c.parts.part2,
                        marks: { ...(c.parts.part2.marks || {}), [it.id]:
                          { ...((c.parts.part2.marks || {})[it.id]), ja: "ok" } } } }
                    }))}
                  >○</button>
                  <button type="button" className="mark-btn wrong"
                    onClick={() => setWs((c) => ({
                      ...c,
                      parts: { ...c.parts, part2: { ...c.parts.part2,
                        marks: { ...(c.parts.part2.marks || {}), [it.id]:
                          { ...((c.parts.part2.marks || {})[it.id]), ja: "wrong" } } } }
                    }))}
                  >×</button>
                  <button type="button" className="mark-btn clear"
                    onClick={() => setWs((c) => {
                      const base = { ...(c.parts.part2.marks || {}) };
                      const rec = { ...(base[it.id] || {}) };
                      delete rec.ja; base[it.id] = rec;
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
            multiline rows={3} autoGrow className="input field-full teacher-comment"
            value={ws.parts.part2.trainerNotes || ""}
            onDraft={(v)=>v}
            onCommit={(v) => setWs((cur) => ({
              ...cur,
              parts: { ...cur.parts, part2: { ...cur.parts.part2, trainerNotes: v } }
            }))}
          />
        </div>
      ) : ws.parts.part2.trainerNotes ? (
        <div className="teacher-note">
          <strong>講師コメント：</strong><br />{ws.parts.part2.trainerNotes}
        </div>
      ) : null}
    </Card>
  );
});

/* ====== Part3 ====== */
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
                    onDraft={(v)=>v}
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
                    onDraft={(v)=>v}
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
                        ...cur,
                        parts: {
                          ...cur.parts,
                          part3: {
                            ...cur.parts.part3,
                            answers: { ...prevAns, [it.id]: v },
                            answersUpdatedAt: { ...prevTs, [it.id]: ts },
                          },
                        },
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
                  onDraft={(v)=>v}
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
    part4: { label: "Part 4｜英作文", instructions: "本日のテーマに沿って80–120語で英作文を作ろう。", answer: "", handwriting: null, trainerNotes: "" },
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

  // データ保存（ローカル）
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

  // 起動/日付変更時にクラウド読込
  useEffect(() => {
    (async () => {
      try {
        setStatus("クラウド読込中…");
        const remote = await cloudLoad({ userId, dateISO });
        if (remote && remote.data) {
          setWs(prev => ensureMaps(remote.data, dateISO));
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

  // ドット用（省略版）
  const markedDates = useMemo(() => new Set(), []);
  const submittedDates = useMemo(() => new Set(), []);
  const trainerDates = useMemo(() => new Set(), []);

  const draftRef = useRef({ p1: {}, p2: {}, p3: {} }); // 使い続けます（バックアップ用）

  const submit = useCallback(() => {
    setWs((c) => ({ ...c, submittedAt: new Date().toISOString() }));
  }, []);

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

  const Header = React.memo(function HeaderInner() {
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
              <button type="button" className="hdr-btn" onClick={() => setShowCal((v) => !v)}>カレンダー</button>
              {mode === "student" ? (
                <>
                  <input type="password" inputMode="numeric" maxLength={4} className="pin-4ch" placeholder="PIN"
                        value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))} aria-label="講師PIN" />
                  <button type="button" className="hdr-btn-primary" onClick={() => { if (pinInput === DEFAULT_PIN) setMode("trainer"); else alert("PINが違います。"); }}>講師モード</button>
                </>
              ) : (
                <button type="button" className="hdr-btn" onClick={() => setMode("student")}>学習者モードへ</button>
              )}
            </div>
          </div>
        </div>

        <div className="header-row">
          <div className="container">
            <div className="hstack" style={{ justifyContent: "space-between" }}>
              <div className="hstack">
                <button type="button" className="hdr-btn-primary">同期</button>
                {mode === "trainer" && (
                  <button type="button" className="hdr-btn danger-btn" title="この日の出題を初期化">出題リセット</button>
                )}
                <button type="button" className="hdr-btn submit-btn" onClick={submit}>提出</button>
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
            {/* カレンダー本体は省略（前回から変更なし） */}
          </div>
        )}
      </header>
    );
  });

  const ThemeBar = React.memo(() => (
    <Card title="本日のテーマ">
      {mode === "trainer" ? (
        <DebouncedInput
          multiline rows={2} className="input field-full theme-input"
          placeholder="Week 4｜Tuesday（Emergency）- ..."
          value={ws.meta.theme}
          onDraft={(v)=>v}
          onCommit={(v) => setWs((cur) => ({ ...cur, meta: { ...cur.meta, theme: v } }))}
        />
      ) : (
        <p className="theme-text" style={{ margin: 0, whiteSpace: "pre-line" }}>
        {ws.meta.theme || "（未設定）"}</p>
      )}
    </Card>
  ));

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(to bottom, #fff, #f9fafb)" }}>
      <Header />
      <ThemeBar />
      <Part1  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={draftRef} />
      <Part2  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={draftRef} />
      <Part3  Card={Card} ws={ws} setWs={setWs} mode={mode} draftRef={draftRef} />
      {/* Part4は前回と同様、必要なら追補します */}
      <footer className="container" style={{ padding: "32px 16px", textAlign: "center", fontSize: 12, color: "#6b7280" }}>©︎annetmii - 学習を習慣に</footer>
    </div>
  );
}
