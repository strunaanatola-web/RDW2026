import https from "https";
import http from "http";
import { checkAuth } from "./_auth.js";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
// Token sent to Apps Script for ITS OWN auth check.
// This is separate from APP_PASSWORD (which gates the Netlify function itself).
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

export async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  // Auth gate
  const auth = checkAuth(event);
  if (!auth.ok) {
    return { statusCode: auth.status, headers: CORS, body: JSON.stringify({ error: auth.error }) };
  }

  if (!APPS_SCRIPT_URL) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Lipsește APPS_SCRIPT_URL în Netlify Environment Variables." }) };
  }

  try {
    let url = APPS_SCRIPT_URL + "?action=getLatest";
    if (APPS_SCRIPT_TOKEN) {
      url += "&token=" + encodeURIComponent(APPS_SCRIPT_TOKEN);
    }
    const data = await fetchWithRedirects(url, 0);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
  } catch(err) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

function fetchWithRedirects(url, count) {
  return new Promise((resolve, reject) => {
    if (count > 10) return reject(new Error("Too many redirects"));
    let urlObj;
    try { urlObj = new URL(url); } catch(e) { return reject(new Error("Bad URL")); }

    const lib = urlObj.protocol === "https:" ? https : http;
    const req = lib.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
    }, function(res) {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        let loc = res.headers.location;
        if (!loc.startsWith("http")) loc = urlObj.protocol + "//" + urlObj.hostname + loc;
        res.resume();
        resolve(fetchWithRedirects(loc, count + 1));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => body += c);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error("Parse failed: " + body.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}
