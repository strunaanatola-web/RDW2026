const https = require("https");
const http = require("http");

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzQo-07z9g-EyZFWX4fDwBi7NLabF9CVQ6VYUwepJnD0A772NK2shA4vclVae5W7etm/exec";
const SECRET_TOKEN = "opm-RDW-2026";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

exports.handler = async function(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const token = event.queryStringParameters && event.queryStringParameters.token;
  if (token !== SECRET_TOKEN) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  try {
    const url = APPS_SCRIPT_URL + "?action=getLatest&token=" + encodeURIComponent(SECRET_TOKEN);
    const data = await fetchWithRedirects(url, 0);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
  } catch(err) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: err.message }) };
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
    req.setTimeout(25000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}
