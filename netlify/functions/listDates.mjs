export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  const { GITHUB_TOKEN, REPO, GITHUB_REPO, PATH_PREFIX = "masayuki" } = process.env;
  const REPO_NAME = REPO || GITHUB_REPO;
  if (!GITHUB_TOKEN || !REPO_NAME) {
    console.error("ENV MISSING", { hasToken: !!GITHUB_TOKEN, REPO_NAME });
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing env" }) };
  }
  const [owner, repo] = REPO_NAME.split("/");

  const url = new URL(event.rawUrl);
  const user = url.searchParams.get("user");
  if (!user) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing user" }) };

  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${PATH_PREFIX}/${user}`;
  console.info("LIST dates from", api);

  const r = await fetch(api, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "annetmii-english-camp-netlify",
    }
  });

  if (r.status === 404) return { statusCode: 200, headers, body: JSON.stringify({ dates: [] }) };
  if (r.status !== 200) {
    const t = await r.text();
    console.error("LIST GitHub error", r.status, t);
    return { statusCode: r.status, headers, body: JSON.stringify({ error: t }) };
  }
  const arr = await r.json();
  const dates = (arr || [])
    .map((e) => e.name)
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .map((n) => n.slice(0, 10));
  return { statusCode: 200, headers, body: JSON.stringify({ dates }) };
}
