// netlify/functions/save.js
const { Octokit } = require("octokit");

const OWNER = "annetmii";     // ← 確定
const REPO  = "english-camp"; // ← 確定

let lastCallAt = 0;
const MIN_INTERVAL_MS = 5000;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const now = Date.now();
    if (now - lastCallAt < MIN_INTERVAL_MS) {
      return { statusCode: 429, body: JSON.stringify({ ok: false, error: "Too Many Requests" }) };
    }
    lastCallAt = now;

    const token = process.env.GITHUB_TOKEN;
    if (!token) return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Missing GITHUB_TOKEN" }) };

    const { daysPath, daysContent, subPath, subContent } = JSON.parse(event.body || "{}");

    const isSafe = (p) => typeof p === "string" && !p.includes("..") && !p.startsWith("/") && p.length < 200;
    if ((daysPath && !isSafe(daysPath)) || (subPath && !isSafe(subPath))) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Invalid path" }) };
    }

    const octokit = new Octokit({ auth: token });

    async function upsert(path, obj) {
      if (!path || obj == null) return;
      let sha;
      try {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: OWNER, repo: REPO, path
        });
        sha = data.sha;
      } catch (_) {}
      const message = `save ${path} at ${new Date().toISOString()}`;
      const content = Buffer.from(JSON.stringify(obj, null, 2)).toString("base64");
      await octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
        owner: OWNER, repo: REPO, path, message, content, sha
      });
    }

    await upsert(daysPath, daysContent);
    await upsert(subPath,  subContent);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
