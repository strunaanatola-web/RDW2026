const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}


function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
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

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: mimeType || "image/jpeg" });
  const formData = new FormData();

  formData.append("model", model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
  formData.append("prompt", prompt);
  formData.append("size", process.env.OPENAI_IMAGE_SIZE || "1024x1024");
  formData.append("image", blob, "building.jpg");

  const timeout = timeoutSignal(Number(process.env.OPENAI_TIMEOUT_MS || 35000));

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: timeout.signal
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("OpenAI timeout; se încearcă fallback Gemini.");
    }
    throw err;
  } finally {
    timeout.clear();
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || `OpenAI error ${response.status}`);
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI nu a returnat imagine b64_json.");

  return { image: b64, mimeType: "image/png", providerUsed: "openai", modelUsed: model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2" };
}

async function generateWithGemini({ prompt, imageBase64, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Lipsește GEMINI_API_KEY în Netlify Environment Variables.");

  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
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
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || `Gemini error ${response.status}`);
  }

  const img = firstImageFromGemini(data);
  if (!img) throw new Error("Gemini nu a returnat imagine.");

  return { ...img, providerUsed: "gemini", modelUsed: model };
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const { prompt, imageBase64, mimeType } = body;
    const provider = body.provider || "openai";
    const model = body.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

    if (!prompt || !imageBase64) return json(400, { error: "Lipsește promptul sau imaginea." });

    if (provider === "gemini") {
      const gemini = await generateWithGemini({ prompt, imageBase64, mimeType });
      return json(200, gemini);
    }

    try {
      const openai = await generateWithOpenAI({ prompt, imageBase64, mimeType, model });
      return json(200, openai);
    } catch (openaiError) {
      try {
        const gemini = await generateWithGemini({ prompt, imageBase64, mimeType });
        return json(200, {
          ...gemini,
          fallback: true,
          primaryProviderError: openaiError.message
        });
      } catch (geminiError) {
        return json(502, {
          error: "Au eșuat atât OpenAI, cât și fallback-ul Gemini.",
          openaiError: openaiError.message,
          geminiError: geminiError.message
        });
      }
    }
  } catch (err) {
    return json(500, { error: err.message });
  }
};
