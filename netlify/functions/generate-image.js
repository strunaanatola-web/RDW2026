const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

const ALLOWED_GEMINI_MODELS = new Set([
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview"
]);

function normalizeGeminiModel(model) {
  const requested = String(model || "gemini-2.5-flash-image").trim();
  return ALLOWED_GEMINI_MODELS.has(requested) ? requested : "gemini-2.5-flash-image";
}

async function generateWithGemini(options) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Lipseste GEMINI_API_KEY.");

  const { prompt, imageBase64, mimeType } = options;
  const model = normalizeGeminiModel(options.model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  console.log("[generate-image] Gemini start model=" + model + " length=" + imageBase64.length);

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
      ]
    }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"]
    }
  };

  let response;
  try {
    response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + apiKey,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }
    );
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Timeout Gemini");
    throw err;
  }
  clearTimeout(timeout);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    console.log("[generate-image] Gemini ERROR " + JSON.stringify(data).slice(0, 300));
    throw new Error(data.error?.message || "Gemini error " + response.status);
  }

  const parts = data.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imgPart) {
    console.log("[generate-image] Gemini NO IMAGE parts=" + JSON.stringify(parts).slice(0, 300));
    throw new Error("Gemini nu a returnat imagine.");
  }

  console.log("[generate-image] Gemini success mimeType=" + imgPart.inlineData.mimeType);
  return {
    image: imgPart.inlineData.data,
    mimeType: imgPart.inlineData.mimeType || "image/png",
    providerUsed: "gemini",
    modelUsed: model
  };
}

async function generateWithOpenAI(options) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Lipseste OPENAI_API_KEY.");

  const { prompt, imageBase64, mimeType } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  console.log("[generate-image] OpenAI start length=" + imageBase64.length);

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: mimeType || "image/jpeg" });
  const formData = new FormData();
  formData.append("model", "gpt-image-1");
  formData.append("prompt", prompt);
  formData.append("size", "1024x1024");
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
    if (err.name === "AbortError") throw new Error("Timeout OpenAI");
    throw err;
  }
  clearTimeout(timeout);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    console.log("[generate-image] OpenAI ERROR " + JSON.stringify(data).slice(0, 300));
    throw new Error(data.error?.message || "OpenAI error " + response.status);
  }

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    // openai may return url instead of b64
    const url = data.data?.[0]?.url;
    if (url) {
      console.log("[generate-image] OpenAI returned URL, fetching...");
      const imgResp = await fetch(url);
      const imgBuf = await imgResp.arrayBuffer();
      const imgB64 = Buffer.from(imgBuf).toString("base64");
      return { image: imgB64, mimeType: "image/png", providerUsed: "openai", modelUsed: "gpt-image-1" };
    }
    throw new Error("OpenAI nu a returnat imagine.");
  }

  console.log("[generate-image] OpenAI success");
  return { image: b64, mimeType: "image/png", providerUsed: "openai", modelUsed: "gpt-image-1" };
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const { prompt, imageBase64, mimeType, provider, model } = body;
    if (!prompt || !imageBase64) return json(400, { error: "Lipseste promptul sau imaginea." });

    const selectedProvider = provider || "gemini";
    console.log("[generate-image] provider=" + selectedProvider);

    let result;
    if (selectedProvider === "openai") {
      result = await generateWithOpenAI({ prompt, imageBase64, mimeType });
    } else {
      try {
        result = await generateWithGemini({ prompt, imageBase64, mimeType, model });
      } catch (geminiErr) {
        console.log("[generate-image] Gemini failed: " + geminiErr.message + " — OpenAI fallback");
        if (!process.env.OPENAI_API_KEY) throw geminiErr;
        result = await generateWithOpenAI({ prompt, imageBase64, mimeType });
        result.fallback = true;
      }
    }

    return json(200, result);
  } catch (err) {
    console.log("[generate-image] FINAL ERROR " + err.message);
    return json(500, { error: err.message });
  }
};
