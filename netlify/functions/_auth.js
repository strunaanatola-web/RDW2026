// netlify/functions/_auth.js
// Shared authentication helper. Used by all protected functions.

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getHeader(event, name) {
  if (!event || !event.headers) return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(event.headers)) {
    if (key.toLowerCase() === target) return event.headers[key];
  }
  return undefined;
}

function checkAuth(event) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return {
      ok: false,
      status: 500,
      error: "APP_PASSWORD nu este configurat in Netlify Environment Variables."
    };
  }
  const provided = getHeader(event, "X-App-Password");
  if (!provided) {
    return { ok: false, status: 401, error: "Lipseste parola." };
  }
  if (!constantTimeEqual(String(provided), String(expected))) {
    return { ok: false, status: 401, error: "Parola incorecta." };
  }
  return { ok: true };
}

module.exports = { checkAuth };
