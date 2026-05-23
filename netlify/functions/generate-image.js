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

const ALLOWED_STABILITY_MODELS = new Set([
  "stable-image-control-structure"
]);

function normalizeStabilityModel(model) {
  const requested = String(model || "stable-image-control-structure").trim();
  return ALLOWED_STABILITY_MODELS.has(requested) ? requested : "stable-image-control-structure";
}

async function generateWithStability(options) {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error("Lipseste STABILITY_API_KEY.");

  const { prompt, imageBase64, mimeType } = options;
  const model = normalizeStabilityModel(options.model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  console.log("[generate-image] Stability start model=" + model + " length=" + imageBase64.length);

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: mimeType || "image/jpeg" });
  const formData = new FormData();
  formData.append("image", blob, "building.jpg");
  formData.append("prompt", prompt);
  formData.append("control_strength", String(options.controlStrength || process.env.STABILITY_CONTROL_STRENGTH || "0.65"));
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
    throw new Error(errText || "Stability AI error " + response.status);
  }

  const imgBuf = await response.arrayBuffer();
  const imgB64 = Buffer.from(imgBuf).toString("base64");

  console.log("[generate-image] Stability success");
  return {
    image: imgB64,
    mimeType: "image/png",
    providerUsed: "stability",
    modelUsed: model
  };
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
    if (selectedProvider === "stability") {
      result = await generateWithStability({ prompt, imageBase64, mimeType, model });
    } else if (selectedProvider === "gemini") {
      result = await generateWithGemini({ prompt, imageBase64, mimeType, model });
    } else {
      return json(400, { error: "Provider invalid. Folosește gemini sau stability." });
    }

    return json(200, result);
  } catch (err) {
    console.log("[generate-image] FINAL ERROR " + err.message);
    return json(500, { error: err.message });
  }
};
