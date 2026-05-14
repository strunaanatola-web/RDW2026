const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function withTimeout(promise, ms, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    run: async () => {
      try {
        return await promise(controller.signal);
      } catch (err) {
        if (err && err.name === "AbortError") {
          throw new Error(`${label} timeout după ${ms}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

async function generateWithOpenAIOnly({ prompt, imageBase64, mimeType }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Lipsește OPENAI_API_KEY în Netlify Environment Variables.");

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1024";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 45000);

  console.log(`[generate-image] OpenAI ONLY start model=${model} size=${size} timeout=${timeoutMs}ms imageBase64Length=${imageBase64?.length || 0}`);

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: mimeType || "image/jpeg" });
  const formData = new FormData();

  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("size", size);
  formData.append("image", blob, "building.jpg");

  const timed = withTimeout(async (signal) => {
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal
    });

    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (e) {
      console.log("[generate-image] OpenAI non-JSON response:", raw.slice(0, 800));
      throw new Error("OpenAI a returnat un răspuns non-JSON.");
    }

    if (!response.ok || data.error) {
      console.log("[generate-image] OpenAI API error status=", response.status, "body=", JSON.stringify(data).slice(0, 1200));
      throw new Error(data?.error?.message || `OpenAI error ${response.status}`);
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      console.log("[generate-image] OpenAI response without b64_json:", JSON.stringify(data).slice(0, 1200));
      throw new Error("OpenAI nu a returnat imagine b64_json.");
    }

    console.log(`[generate-image] OpenAI success imageLength=${b64.length}`);

    return {
      image: b64,
      mimeType: "image/png",
      providerUsed: "openai",
      modelUsed: model,
      fallback: false
    };
  }, timeoutMs, "OpenAI");

  return await timed.run();
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const body = JSON.parse(event.body || "{}");
    const { prompt, imageBase64, mimeType } = body;

    if (!prompt || !imageBase64) {
      return json(400, { error: "Lipsește promptul sau imaginea." });
    }

    const result = await generateWithOpenAIOnly({ prompt, imageBase64, mimeType });
    return json(200, result);

  } catch (err) {
    console.log("[generate-image] FINAL ERROR:", err && err.stack ? err.stack : err.message);
    return json(502, {
      error: err.message || "Eroare OpenAI necunoscută.",
      providerUsed: "openai",
      fallback: false
    });
  }
};
