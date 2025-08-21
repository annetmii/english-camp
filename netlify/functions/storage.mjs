export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  // 互換: 旧名を入れてしまった場合でも拾う
  const {
    GITHUB_TOKEN,
    REPO,
    GITHUB_REPO,
    PATH_PREFIX = "masayuki",
    TRAINER_PIN,
    PIN_CODE,
    GITHUB_BRANCH,
  } = process.env;

  const REPO_NAME = REPO || GITHUB_REPO;
  const TRAINER = TRAINER_PIN || PIN_CODE;
  const BRANCH = GITHUB_BRANCH || "main";

  if (!GITHUB_TOKEN || !REPO_NAME) {
    console.error("ENV MISSING", { hasToken: !!GITHUB_TOKEN, REPO_NAME });
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing env (GITHUB_TOKEN/REPO)" }) };
  }

  const [owner, repo] = REPO_NAME.split("/");
  const gh = async (path, init) => {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,   // fine-grained PAT でもOK
        Accept: "application/vnd.github+json",
        "User-Agent": "annetmii-english-camp-netlify",
        ...(init && init.headers || {}),
      },
    });
  };

  if (event.httpMethod === "GET") {
    const url = new URL(event.rawUrl);
    const user = url.searchParams.get("user");
    const date = url.searchParams.get("date");
    if (!user || !date) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing user/date" }) };

    const path = `${PATH_PREFIX}/${user}/${date}.json`;
    console.info("GET storage", { owner, repo, path });

    const r = await gh(`${path}?ref=${BRANCH}`);
    if (r.status === 200) {
      const j = await r.json();
      const data = JSON.parse(Buffer.from(j.content, j.encoding || "base64").toString());
      return { statusCode: 200, headers, body: JSON.stringify({ data, sha: j.sha }) };
    }
    if (r.status === 404) return { statusCode: 200, headers, body: JSON.stringify({ data: null }) };

    const text = await r.text();
    console.error("GET GitHub error", r.status, text);
    return { statusCode: r.status, headers, body: JSON.stringify({ error: text }) };
  }

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
    const { user, date, data, asTrainer, pin } = body;
    if (!user || !date || !data) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing fields" }) };

    // PIN検証（講師モードのみ）
    if (asTrainer) {
      if (!TRAINER) return { statusCode: 500, headers, body: JSON.stringify({ error: "TRAINER_PIN not set" }) };
      if (pin !== TRAINER) return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid PIN" }) };
    }

    const path = `${PATH_PREFIX}/${user}/${date}.json`;
    console.info("POST storage -> PUT to GitHub", { owner, repo, path });

    // 既存sha取得
    let sha = undefined;
    const check = await gh(`${path}?ref=${BRANCH}`);
    if (check.status === 200) {
      const j = await check.json();
      sha = j.sha;
    } else if (check.status !== 404) {
      const t = await check.text();
      console.error("CHECK GitHub error", check.status, t);
    }

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    const put = await gh(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // ★ Netlify ビルドを必ずスキップ
     body: JSON.stringify({
        message: `chore(data): save ${user}/${date}.json [skip netlify]`,
        content,
        sha,
        branch: BRANCH,
      }),
    });

    const bodyText = await put.text();
    if (put.status === 201 || put.status === 200) {
      console.info("PUT OK", put.status, bodyText);
      try {
        const j = JSON.parse(bodyText);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, path, sha: j?.content?.sha }) };
      } catch {
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, path }) };
      }
    }

    console.error("PUT GitHub error", put.status, bodyText);
    return { statusCode: put.status, headers, body: JSON.stringify({ error: bodyText, path }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
}
