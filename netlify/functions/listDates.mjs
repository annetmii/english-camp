export async function handler(event) {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };
  const { GITHUB_TOKEN, REPO, PATH_PREFIX = "masayuki" } = process.env;
  if (!GITHUB_TOKEN || !REPO) return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing env" }) };
  const [owner, repo] = REPO.split("/");
  const url = new URL(event.rawUrl);
  const user = url.searchParams.get("user");
  if (!user) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing user" }) };
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${PATH_PREFIX}/${user}`, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" } });
  if (r.status === 404) return { statusCode: 200, headers, body: JSON.stringify({ dates: [] }) };
  if (r.status !== 200) return { statusCode: r.status, headers, body: JSON.stringify({ error: "GitHub list error" }) };
  const arr = await r.json();
  const dates = (arr || []).map((e) => e.name).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).map((n) => n.slice(0, 10));
  return { statusCode: 200, headers, body: JSON.stringify({ dates }) };
}
