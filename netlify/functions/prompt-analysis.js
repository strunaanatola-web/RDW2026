const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) return json(500, { error: "Lipsește CLAUDE_API_KEY în Netlify Environment Variables." });

    const body = JSON.parse(event.body || "{}");
    const imageBase64 = body.imageBase64;
    const mimeType = body.mimeType || "image/jpeg";
    const prompt = body.prompt || `You are an expert urban architect and AI image generation specialist. Analyze this photograph and generate a detailed, professional image generation prompt for urban transformation.

Respond ONLY in this exact format:

ANALIZA: [2-3 sentences in Romanian describing: building type, architectural style, current materials, condition, key elements visible]

PROMPT GENERARE: [Write a detailed English prompt for AI image generation. Include photorealistic style, materials, lighting, what to keep from original, what to transform, colors, textures, atmosphere. Minimum 80 words.]`;

    if (!imageBase64) return json(400, { error: "Lipsește imaginea." });

    const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: 0.35,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      return json(response.status || 500, { error: data?.error?.message || "Claude API error", details: data });
    }

    const text = data.content?.find(part => part.type === "text")?.text || "";
    return json(200, { text });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
