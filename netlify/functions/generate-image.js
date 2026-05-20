const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

// ── GEMINI img2img ──────────────────────────────────────────────
async function generateWithGemini(options) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Lipseste GEMINI_API_KEY in Netlify Environment Variables.");

  const { prompt, imageBase64, mimeType } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  console.log("[generate-image] Gemini start imageBase64Length=" + imageBase64.length);

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
      ]
    }],
    generationConfig: {
      responseModalities: ["image", "text"],
      responseMimeType: "image/png"
    }
  };

  let response;
  try {
    response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-image-generation:generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Timeout Gemini API");
    throw err;
  }
  clearTimeout(timeout);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    console.log("[generate-image] Gemini ERROR " + JSON.stringify(data).slice(0, 500));
    throw new Error(data.error?.message || "Gemini error " + response.status);
  }

  const parts = data.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imgPart) {
    console.log("[generate-image] Gemini NO IMAGE " + JSON.stringify(data).slice(0, 500));
    throw new Error("Gemini nu a returnat imagine.");
  }

  console.log("[generate-image] Gemini success");
  return {
    image: imgPart.inlineData.data,
    mimeType: imgPart.inlineData.mimeType || "image/png",
    providerUsed: "gemini",
    modelUsed: "gemini-2.5-flash-preview-image-generation"
  };
}

// ── OPENAI img2img ──────────────────────────────────────────────
async function generateWithOpenAI(options) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Lipseste OPENAI_API_KEY in Netlify Environment Variables.");

  const { prompt, imageBase64, mimeType } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  console.log("[generate-image] OpenAI start model=gpt-image-1 imageBase64Length=" + imageBase64.length);

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: mimeType || "image/jpeg" });
  const formData = new FormData();
  formData.append("model", "gpt-image-1");
  formData.append("prompt", prompt);
  formData.append("size", "1024x1024");
  formData.append("response_format", "b64_json");
  formData.append("image", blob, "building.jpg");

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey },
      body: formData,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Timeout OpenAI API");
    throw err;
  }
  clearTimeout(timeout);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    console.log("[generate-image] OpenAI ERROR " + JSON.stringify(data).slice(0, 500));
    throw new Error(data.error?.message || "OpenAI error " + response.status);
  }

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI nu a returnat imagine.");

  console.log("[generate-image] OpenAI success");
  return {
    image: b64,
    mimeType: "image/png",
    providerUsed: "openai",
    modelUsed: "gpt-image-1"
  };
}

// ── HANDLER ─────────────────────────────────────────────────────
exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const { prompt, imageBase64, mimeType, provider } = body;

    if (!prompt || !imageBase64) return json(400, { error: "Lipseste promptul sau imaginea." });

    const selectedProvider = provider || "gemini";
    console.log("[generate-image] provider=" + selectedProvider);

    let result;
    if (selectedProvider === "openai") {
      result = await generateWithOpenAI({ prompt, imageBase64, mimeType });
    } else {
      // gemini (default) — cu fallback la openai daca gemini nu are key
      try {
        result = await generateWithGemini({ prompt, imageBase64, mimeType });
      } catch (geminiErr) {
        console.log("[generate-image] Gemini failed: " + geminiErr.message + " — trying OpenAI fallback");
        if (!process.env.OPENAI_API_KEY) throw geminiErr;
        result = await generateWithOpenAI({ prompt, imageBase64, mimeType });
        result.fallback = true;
        result.fallbackReason = geminiErr.message;
      }
    }

    return json(200, result);
  } catch (err) {
    console.log("[generate-image] FINAL ERROR " + err.message);
    return json(500, { error: err.message });
  }
};
