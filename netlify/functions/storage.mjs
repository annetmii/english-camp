export async function handler(event) {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  const { GITHUB_TOKEN, REPO, PATH_PREFIX = "masayuki", TRAINER_PIN } = process.env;
  if (!GITHUB_TOKEN || !REPO) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing env (GITHUB_TOKEN/REPO)" }) };
  }
  const [owner, repo] = REPO.split("/");
  const gh = async (path, init) => {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    return fetch(url, { ...init, headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", ...(init && init.headers || {}) } });
  };

  if (event.httpMethod === "GET") {
    const url = new URL(event.rawUrl);
    const user = url.searchParams.get("user");
    const date = url.searchParams.get("date");
    if (!user || !date) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing user/date" }) };
    const path = `${PATH_PREFIX}/${user}/${date}.json`;
    const r = await gh(path);
    if (r.status === 200) {
      const j = await r.json();
      const data = JSON.parse(Buffer.from(j.content, j.encoding || "base64").toString());
      return { statusCode: 200, headers, body: JSON.stringify({ data, sha: j.sha }) };
    }
    if (r.status === 404) return { statusCode: 200, headers, body: JSON.stringify({ data: null }) };
    return { statusCode: r.status, headers, body: JSON.stringify({ error: "GitHub fetch error" }) };
  }

  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body || "{}");
    const { user, date, data, asTrainer, pin } = body;
    if (!user || !date || !data) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };

    // PIN検証（講師モードのみ）
    if (asTrainer) {
      if (!TRAINER_PIN) return { statusCode: 500, headers, body: JSON.stringify({ error: "TRAINER_PIN not set" }) };
      if (pin !== TRAINER_PIN) return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid PIN" }) };
    }

    const path = `${PATH_PREFIX}/${user}/${date}.json`;
    // 既存ファイルのsha取得
    let sha = undefined;
    const check = await gh(path);
    if (check.status === 200) {
      const j = await check.json();
      sha = j.sha;
    }
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    const r = await gh(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `update ${user}/${date}`, content, sha }) });
    if (r.status === 201 || r.status === 200) {
      const j = await r.json();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, path, sha: j.content.sha }) };
    }
    const text = await r.text();
    return { statusCode: r.status, headers, body: JSON.stringify({ error: text }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
}
