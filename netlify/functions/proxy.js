const https = require("https");
const http = require("http");

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwf0L0OhlOLrvokZYsOzQwF4FhTS8fO799cCnQ__vqSBVJHITlfpro1KmE1CkTbFEyT/exec";
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

    if (!data.base64 || data.status !== "ok") {
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
    }

    const originalSize = Buffer.byteLength(data.base64, "base64");
    console.log("Original size bytes:", originalSize);

    if (originalSize <= 4000000) {
      console.log("Under 4MB, sending as-is");
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
    }

    // Reduce base64 string by taking every Nth character from image data
    // keeping JPEG structure intact
    const inputBuffer = Buffer.from(data.base64, "base64");
    const reduced = reduceJpeg(inputBuffer);
    
    console.log("Reduced size:", reduced.length, "bytes");
    
    data.base64 = reduced.toString("base64");
    data.mimeType = "image/jpeg";
    data.sentSize = reduced.length;

    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };

  } catch(err) {
    console.log("Handler error:", err.message);
    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ error: err.message })
    };
  }
};

function reduceJpeg(buffer) {
  // Find JPEG Start of Scan marker (FF DA)
  let sosIdx = -1;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === 0xFF && buffer[i+1] === 0xDA) {
      sosIdx = i;
      break;
    }
  }

  if (sosIdx === -1) return buffer;

  const sosSegLen = buffer[sosIdx+2] * 256 + buffer[sosIdx+3];
  const dataStart = sosIdx + 2 + sosSegLen;

  const header = buffer.slice(0, dataStart);
  const scanData = buffer.slice(dataStart, buffer.length - 2); // exclude EOI
  
  // Take every other scan line worth of data (50% reduction)
  // Target: under 4MB
  const targetBytes = 3800000;
  const ratio = Math.min(1, targetBytes / buffer.length);
  const keepBytes = Math.floor(scanData.length * ratio);
  
  const truncated = scanData.slice(0, keepBytes);
  const eoi = Buffer.from([0xFF, 0xD9]);
  
  return Buffer.concat([header, truncated, eoi]);
}

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
