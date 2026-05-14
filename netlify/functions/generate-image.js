const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function shortError(err) {
  if (!err) return "Unknown error";
  if (err.name === "AbortError") return "Timeout API";
  return err.message || String(err);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function firstImageFromGemini(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    const mime = inline?.mimeType || inline?.mime_type;
    const b64 = inline?.data;
    if (mime && mime.startsWith("image/") && b64) {
      return { image: b64, mimeType: mime };
    }
  }
  return null;
}

async function generateWithOpenAI({ prompt, imageBase64, mimeType, model }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Lipsește OPENAI_API_KEY în Netlify Environment Variables.");

  const selectedModel = model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const selectedSize = process.env.OPENAI_IMAGE_SIZE || "1024x1024";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 18000);

  console.log(`[generate-image] OpenAI start model=${selectedModel} size=${selectedSize} timeout=${timeoutMs}ms`);

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: mimeType || "image/jpeg" });
  const formData = new FormData();

  formData.append("model", selectedModel);
  formData.append("prompt", prompt);
  formData.append("size", selectedSize);
  formData.append("image", blob, "building.jpg");

  const response = await fetchWithTimeout("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData
  }, timeoutMs);

  const rawText = await response.text();
  let data = {};
  try { data = JSON.parse(rawText); } catch (_) {}

  if (!response.ok || data.error) {
    console.log(`[generate-image] OpenAI failed status=${response.status} body=${rawText.slice(0, 500)}`);
    throw new Error(data?.error?.message || `OpenAI error ${response.status}: ${rawText.slice(0, 200)}`);
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    console.log(`[generate-image] OpenAI no b64 response=${rawText.slice(0, 500)}`);
    throw new Error("OpenAI nu a returnat imagine b64_json.");
  }

  console.log("[generate-image] OpenAI success");
  return { image: b64, mimeType: "image/png", providerUsed: "openai", modelUsed: selectedModel };
}

async function generateWithGemini({ prompt, imageBase64, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Lipsește GEMINI_API_KEY în Netlify Environment Variables.");

  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 25000);

  console.log(`[generate-image] Gemini start model=${model} timeout=${timeoutMs}ms`);

  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
        ]
      }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
    })
  }, timeoutMs);

  const rawText = await response.text();
  let data = {};
  try { data = JSON.parse(rawText); } catch (_) {}

  if (!response.ok || data.error) {
    console.log(`[generate-image] Gemini failed status=${response.status} body=${rawText.slice(0, 500)}`);
    throw new Error(data?.error?.message || `Gemini error ${response.status}: ${rawText.slice(0, 200)}`);
  }

  const img = firstImageFromGemini(data);
  if (!img) {
    console.log(`[generate-image] Gemini no image response=${rawText.slice(0, 500)}`);
    throw new Error("Gemini nu a returnat imagine.");
  }

  console.log("[generate-image] Gemini success");
  return { ...img, providerUsed: "gemini", modelUsed: model };
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const { prompt, imageBase64, mimeType } = body;
    const provider = body.provider || "openai";
    const model = body.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

    if (!prompt || !imageBase64) return json(400, { error: "Lipsește promptul sau imaginea." });

    console.log(`[generate-image] request provider=${provider} imageBase64Length=${imageBase64.length}`);

    if (provider === "gemini") {
      const gemini = await generateWithGemini({ prompt, imageBase64, mimeType });
      return json(200, gemini);
    }

    try {
      const openai = await generateWithOpenAI({ prompt, imageBase64, mimeType, model });
      return json(200, openai);
    } catch (openaiError) {
      console.log(`[generate-image] OpenAI error, trying Gemini fallback: ${shortError(openaiError)}`);
      try {
        const gemini = await generateWithGemini({ prompt, imageBase64, mimeType });
        return json(200, {
          ...gemini,
          fallback: true,
          primaryProviderError: shortError(openaiError)
        });
      } catch (geminiError) {
        console.log(`[generate-image] Gemini fallback failed: ${shortError(geminiError)}`);
        return json(502, {
          error: "Au eșuat atât OpenAI, cât și fallback-ul Gemini.",
          openaiError: shortError(openaiError),
          geminiError: shortError(geminiError)
        });
      }
    }
  } catch (err) {
    console.log(`[generate-image] fatal error: ${shortError(err)}`);
    return json(500, { error: shortError(err) });
  }
};
