const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

// ── GEMINI img2img ──────────────────────────────────────
async function generateWithGemini(options) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Lipseste GEMINI_API_KEY.");
  const { prompt, imageBase64, mimeType, model } = options;
  const geminiModel = model || "gemini-2.5-flash-image";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  console.log("[generate-image] Gemini start model=" + geminiModel);

  const body = {
    contents: [{ parts: [
      { text: prompt },
      { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
    ]}],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
  };

  let response;
  try {
    response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + geminiModel + ":generateContent?key=" + apiKey,
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
    throw new Error(data.error?.message || "Gemini error " + response.status);
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imgPart) throw new Error("Gemini nu a returnat imagine.");

  console.log("[generate-image] Gemini success");
  return { image: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || "image/png", providerUsed: "gemini", modelUsed: geminiModel };
}

// ── STABILITY AI Structure Control ──────────────────────
async function generateWithStability(options) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error("Lipseste STABILITY_API_KEY.");
  const { prompt, imageBase64, mimeType } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  console.log("[generate-image] Stability AI Structure Control start");

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: mimeType || "image/jpeg" });
  const formData = new FormData();
  formData.append("image", blob, "building.jpg");
  formData.append("prompt", prompt);
  formData.append("control_strength", "0.7");
  formData.append("output_format", "png");

  let response;
  try {
    response = await fetch("https://api.stability.ai/v2beta/stable-image/control/structure", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Accept": "image/*"
      },
      body: formData,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Timeout Stability AI");
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.log("[generate-image] Stability ERROR " + errText.slice(0, 300));
    throw new Error("Stability AI error " + response.status + ": " + errText.slice(0, 200));
  }

  const imgBuffer = await response.arrayBuffer();
  const imgB64 = Buffer.from(imgBuffer).toString("base64");
  console.log("[generate-image] Stability AI success");
  return { image: imgB64, mimeType: "image/png", providerUsed: "stability", modelUsed: "structure-control" };
}

// ── OPENAI img2img ──────────────────────────────────────
async function generateWithOpenAI(options) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Lipseste OPENAI_API_KEY.");
  const { prompt, imageBase64, mimeType } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  console.log("[generate-image] OpenAI start model=gpt-image-1");

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
  if (!response.ok || data.error) throw new Error(data.error?.message || "OpenAI error " + response.status);
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI nu a returnat imagine.");
  console.log("[generate-image] OpenAI success");
  return { image: b64, mimeType: "image/png", providerUsed: "openai", modelUsed: "gpt-image-1" };
}

// ── HANDLER ─────────────────────────────────────────────
exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const { prompt, imageBase64, mimeType, provider, model } = body;
    if (!prompt || !imageBase64) return json(400, { error: "Lipseste promptul sau imaginea." });

    const selectedProvider = provider || "gemini";
    console.log("[generate-image] provider=" + selectedProvider + " model=" + (model || "default"));

    let result;
    if (selectedProvider === "stability") {
      result = await generateWithStability({ prompt, imageBase64, mimeType });
    } else if (selectedProvider === "openai") {
      result = await generateWithOpenAI({ prompt, imageBase64, mimeType });
    } else {
      // gemini (default)
      try {
        result = await generateWithGemini({ prompt, imageBase64, mimeType, model });
      } catch (geminiErr) {
        console.log("[generate-image] Gemini failed: " + geminiErr.message + " — Stability fallback");
        if (process.env.STABILITY_API_KEY) {
          result = await generateWithStability({ prompt, imageBase64, mimeType });
          result.fallback = true;
        } else {
          throw geminiErr;
        }
      }
    }

    return json(200, result);
  } catch (err) {
    console.log("[generate-image] FINAL ERROR " + err.message);
    return json(500, { error: err.message });
  }
};
