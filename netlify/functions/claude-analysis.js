const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function buildPrompt(language) {
  if (language === "en") {
    return `Analyze this image as an architecture critic.

Write the entire response in English only. Do not use Romanian.
Use exactly these section headings, in this order:
TITLE
STYLE AND CONTEXT
WHAT IS STRUCTURALLY INTERESTING
THE DETAIL WORTH NOTICING
WHAT THE SPACE SAYS AS A WHOLE
URBAN REALITY

Keep the analysis clear, specific, and architectural. Avoid generic descriptions.`;
  }

  return `Analizează această imagine ca un critic de arhitectură.

Scrie întregul răspuns doar în română. Nu folosi engleză în paragrafe.
Folosește exact aceste titluri de secțiuni, în această ordine:
TITLU
STILUL ȘI CONTEXTUL
CE E STRUCTURAL INTERESANT
DETALIUL CARE MERITĂ ATENȚIE
CE SPUNE SPAȚIUL ÎN ANSAMBLU
REALITATEA URBANĂ

Păstrează analiza clară, specifică și arhitecturală. Evită descrierile generice.`;
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Lipsește ANTHROPIC_API_KEY.");

    const body = JSON.parse(event.body || "{}");
    const imageBase64 = body.imageBase64;
    const mimeType = body.mimeType || "image/jpeg";
    const language = body.analysisLanguage === "en" || body.language === "en" || body.targetLanguage === "English" ? "en" : "ro";
    const prompt = body.prompt || buildPrompt(language);

    if (!imageBase64) return json(400, { error: "Lipsește imaginea." });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
        max_tokens: 1200,
        temperature: 0.3,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
            { type: "text", text: prompt }
          ]
        }]
      }),
      signal: controller.signal
    }).catch((err) => {
      clearTimeout(timeout);
      if (err.name === "AbortError") throw new Error("Timeout Claude");
      throw err;
    });

    clearTimeout(timeout);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Claude error " + response.status);
    }

    const text = (data.content || []).filter(part => part.type === "text").map(part => part.text).join("\n").trim();
    if (!text) throw new Error("Claude nu a returnat text.");
    return json(200, { text, language });
  } catch (err) {
    console.log("[claude-analysis] ERROR", err.message);
    return json(500, { error: err.message });
  }
};
