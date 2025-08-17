// netlify/functions/load.js
const { Octokit } = require("octokit");

const OWNER = "annetmii";     // ← 確定
const REPO  = "english-camp"; // ← 確定

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };

    const token = process.env.GITHUB_TOKEN;
    if (!token) return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Missing GITHUB_TOKEN" }) };

    const url = new URL(event.rawUrl);
    const daysPath = url.searchParams.get("daysPath");
    const subPath  = url.searchParams.get("subPath");

    const isSafe = (p) => typeof p === "string" && !p.includes("..") && !p.startsWith("/") && p.length < 200;
    if ((daysPath && !isSafe(daysPath)) || (subPath && !isSafe(subPath))) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Invalid path" }) };
    }

    const octokit = new Octokit({ auth: token });

    async function getJson(path) {
      if (!path) return null;
      try {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: OWNER, repo: REPO, path
        });
        const text = Buffer.from(data.content, "base64").toString("utf-8");
        return JSON.parse(text);
      } catch (_) {
        return null;
      }
    }

    const days = await getJson(daysPath);
    const sub  = await getJson(subPath);

    return { statusCode: 200, body: JSON.stringify({ ok: true, days, sub }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e) }) };
  }
};
