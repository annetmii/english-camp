// Netlify Functions save/load で利用する GitHub リポジトリの指定（参考用・フロントでは未使用）
const GITHUB_OWNER = "annetmii";
const GITHUB_REPO  = "english-camp";

const { useState, useEffect } = React;

// PINコードを localStorage に保存・検証する関数
function checkPin() {
  const storedPin = localStorage.getItem("trainerPin");
  if (!storedPin) {
    const newPin = prompt("講師用PINを設定してください（4〜6桁の数字）");
    if (newPin && /^[0-9]{4,6}$/.test(newPin)) {
      localStorage.setItem("trainerPin", newPin);
      alert("PINを設定しました");
      return true;
    }
    alert("PIN設定をキャンセルしました");
    return false;
  } else {
    const inputPin = prompt("講師用PINを入力してください");
    return inputPin === storedPin;
  }
}

async function cloudLoad(user, date) {
  try {
    const q = new URLSearchParams({
      daysPath: `days/${date}.json`,
      subPath: `submissions/${user}/${date}.json`,
    });
    const res = await fetch(`/.netlify/functions/load?${q.toString()}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function cloudSync(db, user, date, setSyncStatus) {
  try {
    setSyncStatus("同期中...");
    const body = {
      daysPath: `days/${date}.json`,
      daysContent: db.days?.[date] || null,
      subPath: `submissions/${user}/${date}.json`,
      subContent: db.submissions?.[user]?.[date] || null,
    };
    const res = await fetch("/.netlify/functions/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("save failed");
    setSyncStatus(`クラウド同期: 最新 ${new Date().toLocaleTimeString("ja-JP")}`);
  } catch (e) {
    setSyncStatus("クラウド同期失敗");
  }
}

function EnglishCampApp() {
  const [role, setRole] = useState("student");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [user, setUser] = useState("Masayuki");
  const [db, setDb] = useState({ days: {}, submissions: {} });
  const [syncStatus, setSyncStatus] = useState("未同期");

  // 起動時と日付/ユーザー変更時にクラウド読み込み
  useEffect(() => {
    cloudLoad(user, date).then((remote) => {
      if (remote?.days) update(["days", date], remote.days);
      if (remote?.sub) update(["submissions", user, date], remote.sub);
    });
    // eslint-disable-next-line
  }, [user, date]);

  function update(path, value) {
    setDb((prev) => {
      const newDb = { ...prev };
      let ref = newDb;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!ref[key]) ref[key] = {};
        ref = ref[key];
      }
      ref[path[path.length - 1]] = value;
      localStorage.setItem("englishCampDB", JSON.stringify(newDb));
      return newDb;
    });
  }

  function handleRoleChange(newRole) {
    if (newRole === "trainer") {
      if (checkPin()) setRole("trainer");
    } else {
      setRole("student");
    }
  }

  // 送信（確定保存）
  const submit = async () => {
    const next = {
      ...(db.submissions?.[user]?.[date] || {}),
      submittedAt: new Date().toISOString(),
    };
    update(["submissions", user, date], next);
    await cloudSync(
      { ...db, submissions: { ...db.submissions, [user]: { ...(db.submissions?.[user]||{}), [date]: next } } },
      user,
      date,
      setSyncStatus
    );
  };

  return (
    <div style={{padding:16, maxWidth:640, margin:"0 auto", fontFamily:"system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto"}}>
      <h1 style={{fontSize:22, fontWeight:"700"}}>annetmii English Camp</h1>

      <div style={{display:"flex", gap:8, marginTop:8, flexWrap:"wrap"}}>
        <select value={role} onChange={(e) => handleRoleChange(e.target.value)}>
          <option value="student">学習者</option>
          <option value="trainer">講師 (PIN)</option>
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input placeholder="氏名" value={user} onChange={(e) => setUser(e.target.value)} />
      </div>

      {/* 本日の学習テーマ */}
      <div style={{marginTop:16}}>
        <label style={{display:"block", fontWeight:"600"}}>本日の学習テーマ</label>
        {role === "trainer" ? (
          <input
            style={{border:"1px solid #ccc", padding:8, width:"100%"}}
            value={db.days?.[date]?.theme || ""}
            onChange={(e) => update(["days", date, "theme"], e.target.value)}
          />
        ) : (
          <div style={{border:"1px solid #ddd", padding:8, background:"#f8f8f8"}}>
            {db.days?.[date]?.theme || "(未設定)"}
          </div>
        )}
      </div>

      {/* Part1〜4 と Feedback はミニマムな形でプレースホルダ */}
      <div style={{marginTop:16}}>
        <label style={{display:"block", fontWeight:"600"}}>Part1 語彙（例：Q1）</label>
        {role === "student" ? (
          <input
            style={{border:"1px solid #ccc", padding:8, width:"100%"}}
            placeholder="あなたの日本語訳"
            onChange={(e) => {
              const cur = db.submissions?.[user]?.[date] || {};
              const part1 = Array.isArray(cur.part1) ? [...cur.part1] : [{id:"q1", answer:""}];
              part1[0] = {id:"q1", answer:e.target.value};
              update(["submissions", user, date], {...cur, part1});
            }}
          />
        ) : (
          <input
            style={{border:"1px solid #ccc", padding:8, width:"100%"}}
            placeholder="講師：提示語彙などを編集（デモ）"
            onChange={(e) => {
              const cur = db.days?.[date] || {};
              const part1 = Array.isArray(cur.part1) ? [...cur.part1] : [{id:"q1", en:"", ja:""}];
              part1[0] = {...part1[0], en:e.target.value};
              update(["days", date], {...cur, part1});
            }}
          />
        )}
      </div>

      <div style={{display:"flex", gap:8, justifyContent:"flex-end", marginTop:16}}>
        {role === "student" && (
          <button onClick={submit} style={{padding:"8px 12px", border:"1px solid #ccc", borderRadius:8}}>解答を送信（クラウド保存）</button>
        )}
        {role === "trainer" && (
          <button onClick={() => cloudSync(db, user, date, setSyncStatus)} style={{padding:"8px 12px", border:"1px solid #ccc", borderRadius:8}}>添削を保存（クラウド保存）</button>
        )}
      </div>

      <footer style={{marginTop:16, fontSize:12, color:"#666"}}>{syncStatus}</footer>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<EnglishCampApp />);
