// netlify/functions/auth-check.js
// Minimal endpoint that just verifies the password.
// Used by the frontend modal to validate the password before saving it.

const { checkAuth } = require("./_auth.js");

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const auth = checkAuth(event);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  return json(200, { ok: true });
};
