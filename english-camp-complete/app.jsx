/* app.jsx — 完全版（CDN React + Netlify Functions 前提 / ビルド不要）
 * 要件：
 * - 学習者は「開く→解答→送信」だけ
 * - Part1=語彙8問 / Part2=構文5問 / Part3=ロールプレイ4問 / Part4=英作文
 * - Trainer Feedback（講師総合コメント）
 * - 本日の学習テーマ：講師が自由入力
 * - 日本語UI、モバイル向け簡素UI、週ジャンル表示なし
 * - ローカル自動保存 + 入力停止60秒でクラウド自動同期 / 送信時は必ず同期
 * - 起動/ユーザー/日付変更時にクラウド自動読み込み
 * - 講師モードはPINロック（4〜6桁）
 */

const { useState, useEffect, useRef } = React;

// ---- 小ユーティリティ ----
const todayISO = () => new Date().toISOString().slice(0, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));
const STORAGE_KEY = "englishCampDB_v4";

// ---- PIN（ローカル保存） ----
function checkPin() {
  const stored = localStorage.getItem("trainerPin");
  if (!stored) {
    const pin = prompt("講師用PINを設定してください（4〜6桁の数字）");
    if (pin && /^[0-9]{4,6}$/.test(pin)) {
      localStorage.setItem("trainerPin", pin);
      alert("PINを設定しました");
      return true;
    }
    alert("PIN設定をキャンセルしました");
    return false;
  }
  const input = prompt("講師用PINを入力してください");
  return input === stored;
}

// ---- クラウドAPI ----
async function cloudLoad(user, date) {
  try {
    const q = new URLSearchParams({
      daysPath: `days/${date}.json`,
      subPath: `submissions/${user}/${date}.json`,
    });
    const res = await fetch(`/.netlify/functions/load?${q.toString()}`);
    return await res.json(); // { ok, days, sub }
  } catch {
    return null;
  }
}
async function cloudSave(snapshot, user, date) {
  const body = {
    daysPath: `days/${date}.json`,
    daysContent: snapshot.days?.[date] || null,
    subPath: `submissions/${user}/${date}.json`,
    subContent: snapshot.submissions?.[user]?.[date] || null,
  };
  const res = await fetch("/.netlify/functions/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("save failed");
}

// ---- デフォルトの出題セット ----
const blankVocab = () => ({ id: crypto.randomUUID(), en: "", ja: "", feedback: "" });
const blankSyntax = () => ({ id: crypto.randomUUID(), prompt: "", hint: "", ja: "", feedback: "" });
const blankRole = () => ({ id: crypto.randomUUID(), jpLine: "", feedback: "" });
const defaultDaySet = () => ({
  theme: "",
  part1: Array.from({ length: 8 }, blankVocab),
  part2: Array.from({ length: 5 }, blankSyntax),
  part3: Array.from({ length: 4 }, blankRole),
  part4: { prompt: "", feedback: "" },
  trainerFeedback: "",
});

// ---- アプリ本体 ----
function EnglishCampApp() {
  // 基本状態
  const [role, setRole] = useState("student");
  const [date, setDate] = useState(todayISO());
  const [user, setUser] = useState("Masayuki");
  const [db, setDb] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { days: {}, submissions: {} };
    } catch {
      return { days: {}, submissions: {} };
    }
  });
  const [syncStatus, setSyncStatus] = useState("未同期");

  // 入力停止デバウンス用
  const idleTimer = useRef(null);
  const touch = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => doCloudAutoSave(), 60_000); // 60秒アイドルで自動同期
  };

  // ローカル保存
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }, [db]);

  // 起動/ユーザー/日付変更時にクラウド読み込み
  useEffect(() => {
    (async () => {
      setSyncStatus("同期中…");
      try {
        const remote = await cloudLoad(user, date);
        if (remote?.days) setDb((prev) => ({ ...prev, days: { ...prev.days, [date]: mergeDay(prev.days?.[date], remote.days) } }));
        else ensureDay(date);

        if (remote?.sub) setDb((prev) => ({
          ...prev,
          submissions: {
            ...prev.submissions,
            [user]: { ...(prev.submissions?.[user] || {}), [date]: remote.sub }
          }
        }));
        setSyncStatus(`クラウド同期: 最新 ${new Date().toLocaleTimeString("ja-JP")}`);
      } catch {
        ensureDay(date);
        setSyncStatus("待機中（ローカル）");
      }
    })();
    // eslint-disable-next-line
  }, [user, date]);

  // ヘルパ：その日の出題存在保証
  function ensureDay(d) {
    setDb((prev) => {
      if (prev.days?.[d]) return prev;
      return { ...prev, days: { ...prev.days, [d]: defaultDaySet() } };
    });
  }
  // ヘルパ：日セットのマージ（remoteとローカルの型ずれを補正）
  function mergeDay(localDay, remoteDay) {
    const scaffold = defaultDaySet();
    const merged = { ...scaffold, ...remoteDay };
    // 配列長が足りなければ補う
    merged.part1 = [...(merged.part1 || []), ...Array.from({ length: Math.max(0, 8 - (merged.part1?.length || 0)) }, blankVocab)].slice(0, 8);
    merged.part2 = [...(merged.part2 || []), ...Array.from({ length: Math.max(0, 5 - (merged.part2?.length || 0)) }, blankSyntax)].slice(0, 5);
    merged.part3 = [...(merged.part3 || []), ...Array.from({ length: Math.max(0, 4 - (merged.part3?.length || 0)) }, blankRole)].slice(0, 4);
    if (!merged.part4) merged.part4 = { prompt: "", feedback: "" };
    return merged;
  }

  // DB更新ユーティリティ
  function update(path, value) {
    setDb((prev) => {
      const next = clone(prev);
      let ref = next;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (ref[k] == null) ref[k] = {};
        ref = ref[k];
      }
      ref[path[path.length - 1]] = value;
      return next;
    });
    touch();
  }

  // ロール切替（講師はPIN）
  function handleRoleChange(newRole) {
    if (newRole === "trainer") {
      if (checkPin()) setRole("trainer");
      return;
    }
    setRole("student");
  }

  // 自動同期（デバウンス発火時）
  async function doCloudAutoSave() {
    try {
      setSyncStatus("同期中…");
      await cloudSave(db, user, date);
      setSyncStatus(`クラウド同期: 最新 ${new Date().toLocaleTimeString("ja-JP")}`);
    } catch {
      setSyncStatus("同期失敗（自動）");
    }
  }

  // 送信（確定同期）
  async function submit() {
    const cur = db.submissions?.[user]?.[date] || {};
    const next = { ...cur, submittedAt: new Date().toISOString() };
    update(["submissions", user, date], next);
    try {
      setSyncStatus("同期中…");
      const snap = clone(db);
      snap.submissions = snap.submissions || {};
      snap.submissions[user] = snap.submissions[user] || {};
      snap.submissions[user][date] = next;
      await cloudSave(snap, user, date);
      setSyncStatus(`クラウド同期: 最新 ${new Date().toLocaleTimeString("ja-JP")}`);
    } catch {
      setSyncStatus("同期失敗（送信）");
      alert("クラウド保存に失敗しました。ネットワークをご確認ください。");
    }
  }

  // ビュー用ショートカット
  const daySet = db.days?.[date] || defaultDaySet();
  const sub = db.submissions?.[user]?.[date] || {
    part1: daySet.part1.map((q) => ({ id: q.id, answer: "" })),
    part2: daySet.part2.map((q) => ({ id: q.id, answer: "" })),
    part3: daySet.part3.map((q) => ({ id: q.id, answer: "" })),
    part4: { answer: "" },
    submittedAt: null,
    reviewedAt: null,
  };

  // ---- UI（ビルド不要の素朴なスタイル）----
  const Row = (props) => <div style={{ display: "grid", gap: 6, ...props.style }}>{props.children}</div>;
  const Label = ({ children }) => <label style={{ fontSize: 12, color: "#444" }}>{children}</label>;
  const Text = ({ children }) => <div style={{ fontSize: 14 }}>{children}</div>;
  const Input = (p) => <input {...p} style={{ border: "1px solid #ccc", padding: 8, borderRadius: 6, width: "100%", ...(p.style||{}) }} />;
  const TA = (p) => <textarea {...p} style={{ border: "1px solid #ccc", padding: 8, borderRadius: 6, width: "100%", minHeight: 80, ...(p.style||{}) }} />;

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: "0 auto", fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto" }}>
      {/* ヘッダー */}
      <div style={{ position: "sticky", top: 0, background: "white", paddingBottom: 8, borderBottom: "1px solid #eee", zIndex: 5 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>annetmii English Camp</h1>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <select value={role} onChange={(e) => handleRoleChange(e.target.value)}>
            <option value="student">学習者</option>
            <option value="trainer">講師（PIN）</option>
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input placeholder="氏名" value={user} onChange={(e) => setUser(e.target.value)} />
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>{syncStatus}</div>
        </div>
      </div>

      {/* 本日の学習テーマ */}
      <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>本日の学習テーマ</div>
        {role === "trainer" ? (
          <TA
            placeholder="例：Sales｜新作バッグのクロスセル表現と価格提示"
            value={daySet.theme || ""}
            onChange={(e) => update(["days", date, "theme"], e.target.value)}
          />
        ) : (
          <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, background: "#f8f8f8", whiteSpace: "pre-wrap" }}>
            {daySet.theme || "(未設定)"}
          </div>
        )}
      </div>

      {/* Part 1 語彙 */}
      <section style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Part1 語彙チェック（英単語→日本語訳） — 8問</div>
        {daySet.part1.map((q, i) => (
          <div key={q.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            {role === "trainer" ? (
              <Row style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <Label>英単語（提示）</Label>
                  <Input
                    value={q.en}
                    onChange={(e) => {
                      const arr = clone(daySet.part1); arr[i].en = e.target.value;
                      update(["days", date, "part1"], arr);
                    }}
                  />
                </div>
                <div>
                  <Label>正解（日本語）</Label>
                  <Input
                    value={q.ja}
                    onChange={(e) => {
                      const arr = clone(daySet.part1); arr[i].ja = e.target.value;
                      update(["days", date, "part1"], arr);
                    }}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label>講師コメント（任意）</Label>
                  <TA
                    value={q.feedback || ""}
                    onChange={(e) => { const arr = clone(daySet.part1); arr[i].feedback = e.target.value; update(["days", date, "part1"], arr); }}
                  />
                </div>
              </Row>
            ) : (
              <Row>
                <Text>提示語彙：<b>{q.en || "（講師が入力）"}</b></Text>
                <div>
                  <Label>あなたの日本語訳</Label>
                  <TA
                    value={sub.part1?.[i]?.answer || ""}
                    onChange={(e) => {
                      const cur = clone(sub);
                      cur.part1 = cur.part1 || daySet.part1.map((qq) => ({ id: qq.id, answer: "" }));
                      cur.part1[i] = { id: q.id, answer: e.target.value };
                      update(["submissions", user, date], cur);
                    }}
                  />
                </div>
              </Row>
            )}
          </div>
        ))}
      </section>

      {/* Part 2 構文 */}
      <section style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Part2 構文トレーニング（穴埋め＋日本語訳） — 5問</div>
        {daySet.part2.map((q, i) => (
          <div key={q.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            {role === "trainer" ? (
              <Row>
                <div>
                  <Label>英語文（___ が空欄）</Label>
                  <TA
                    value={q.prompt}
                    onChange={(e) => { const arr = clone(daySet.part2); arr[i].prompt = e.target.value; update(["days", date, "part2"], arr); }}
                  />
                </div>
                <Row style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <Label>ヒント/語彙</Label>
                    <Input
                      value={q.hint}
                      onChange={(e) => { const arr = clone(daySet.part2); arr[i].hint = e.target.value; update(["days", date, "part2"], arr); }}
                    />
                  </div>
                  <div>
                    <Label>正解（日本語訳）</Label>
                    <Input
                      value={q.ja}
                      onChange={(e) => { const arr = clone(daySet.part2); arr[i].ja = e.target.value; update(["days", date, "part2"], arr); }}
                    />
                  </div>
                </Row>
                <div>
                  <Label>講師コメント（任意）</Label>
                  <TA
                    value={q.feedback || ""}
                    onChange={(e) => { const arr = clone(daySet.part2); arr[i].feedback = e.target.value; update(["days", date, "part2"], arr); }}
                  />
                </div>
              </Row>
            ) : (
              <Row>
                <Text>英語文（穴埋め）：<b>{q.prompt || "（講師が入力）"}</b></Text>
                <div style={{ fontSize: 12, color: "#666" }}>ヒント：{q.hint || "—"}</div>
                <div>
                  <Label>あなたの英語（完成文）</Label>
                  <TA
                    value={sub.part2?.[i]?.answer || ""}
                    onChange={(e) => {
                      const cur = clone(sub);
                      cur.part2 = cur.part2 || daySet.part2.map((qq) => ({ id: qq.id, answer: "" }));
                      cur.part2[i] = { id: q.id, answer: e.target.value };
                      update(["submissions", user, date], cur);
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  参考：正解の日本語訳（講師側入力）→ {q.ja || "（未設定）"}
                </div>
              </Row>
            )}
          </div>
        ))}
      </section>

      {/* Part 3 ロールプレイ */}
      <section style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Part3 会話ロールプレイ — 4問</div>
        {daySet.part3.map((q, i) => (
          <div key={q.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            {role === "trainer" ? (
              <Row>
                <div>
                  <Label>Masayukiの日本語セリフ</Label>
                  <TA
                    value={q.jpLine}
                    onChange={(e) => { const arr = clone(daySet.part3); arr[i].jpLine = e.target.value; update(["days", date, "part3"], arr); }}
                  />
                </div>
                <div>
                  <Label>講師コメント（任意）</Label>
                  <TA
                    value={q.feedback || ""}
                    onChange={(e) => { const arr = clone(daySet.part3); arr[i].feedback = e.target.value; update(["days", date, "part3"], arr); }}
                  />
                </div>
              </Row>
            ) : (
              <Row>
                <Text>セリフ（日本語）：<b>{q.jpLine || "（講師が入力）"}</b></Text>
                <div>
                  <Label>あなたの英語（Masayukiのセリフ）</Label>
                  <TA
                    value={sub.part3?.[i]?.answer || ""}
                    onChange={(e) => {
                      const cur = clone(sub);
                      cur.part3 = cur.part3 || daySet.part3.map((qq) => ({ id: qq.id, answer: "" }));
                      cur.part3[i] = { id: q.id, answer: e.target.value };
                      update(["submissions", user, date], cur);
                    }}
                  />
                </div>
              </Row>
            )}
          </div>
        ))}
      </section>

      {/* Part 4 英作文 */}
      <section style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Part4 英作文</div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          {role === "trainer" ? (
            <Row>
              <div>
                <Label>英作文のお題（日本語可）</Label>
                <TA
                  value={daySet.part4?.prompt || ""}
                  onChange={(e) => update(["days", date, "part4", "prompt"], e.target.value)}
                />
              </div>
              <div>
                <Label>講師コメント（任意）</Label>
                <TA
                  value={daySet.part4?.feedback || ""}
                  onChange={(e) => update(["days", date, "part4", "feedback"], e.target.value)}
                />
              </div>
            </Row>
          ) : (
            <Row>
              <Text>お題：<b>{daySet.part4?.prompt || "（講師が入力）"}</b></Text>
              <div>
                <Label>あなたの英作文（英語）</Label>
                <TA
                  value={sub.part4?.answer || ""}
                  onChange={(e) => {
                    const cur = clone(sub);
                    cur.part4 = { answer: e.target.value };
                    update(["submissions", user, date], cur);
                  }}
                />
              </div>
            </Row>
          )}
        </div>
      </section>

      {/* Trainer Feedback（講師総合コメント） */}
      <section style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Trainer Feedback（講師総合コメント）</div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
          <TA
            placeholder="講師から学習者への総合コメント"
            value={daySet.trainerFeedback || ""}
            onChange={(e) => update(["days", date, "trainerFeedback"], e.target.value)}
            disabled={role !== "trainer"}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            {role === "student" ? (
              <button onClick={submit} style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 8 }}>
                解答を送信（クラウド保存）
              </button>
            ) : (
              <button
                onClick={async () => {
                  try {
                    setSyncStatus("同期中…");
                    await cloudSave(db, user, date);
                    setSyncStatus(`クラウド同期: 最新 ${new Date().toLocaleTimeString("ja-JP")}`);
                  } catch {
                    setSyncStatus("同期失敗（保存）");
                    alert("クラウド保存に失敗しました");
                  }
                }}
                style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 8 }}
              >
                添削を保存（クラウド保存）
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 送信・レビュー状況（簡易表示） */}
      <section style={{ marginTop: 16, marginBottom: 48 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>送信・レビュー状況</div>
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, fontSize: 14 }}>
          <div>・学習者送信：{sub.submittedAt ? new Date(sub.submittedAt).toLocaleString("ja-JP") : "未送信"}</div>
          <div>・講師レビュー：{sub.reviewedAt ? new Date(sub.reviewedAt).toLocaleString("ja-JP") : "未"}</div>
        </div>
      </section>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<EnglishCampApp />);
