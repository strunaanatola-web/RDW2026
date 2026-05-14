const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

async function generateWithOpenAI(options) {
  const prompt = options.prompt;
  const imageBase64 = options.imageBase64;
  const mimeType = options.mimeType || "image/jpeg";

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Lipseste OPENAI_API_KEY in Netlify Environment Variables.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(function () {
    controller.abort();
  }, 45000);

  console.log("[generate-image] OpenAI ONLY start model=gpt-image-2 size=1024x1024 timeout=90000ms imageBase64Length=" + imageBase64.length);

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: mimeType });
  const formData = new FormData();

  formData.append("model", "gpt-image-2");
  formData.append("prompt", prompt);
  formData.append("size", "1024x1024");
  formData.append("image", blob, "building.jpg");

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey
      },
      body: formData,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err && err.name === "AbortError") {
      throw new Error("Timeout OpenAI API");
    }
    throw err;
  }

  clearTimeout(timeout);

  const data = await response.json().catch(function () {
    return {};
  });

  if (!response.ok || data.error) {
    console.log("[generate-image] OpenAI ERROR " + JSON.stringify(data).slice(0, 1000));
    throw new Error((data.error && data.error.message) || ("OpenAI error " + response.status));
  }

  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    console.log("[generate-image] OpenAI NO IMAGE " + JSON.stringify(data).slice(0, 1000));
    throw new Error("OpenAI nu a returnat imagine.");
  }

  console.log("[generate-image] OpenAI success imageLength=" + b64.length);

  return {
    image: b64,
    mimeType: "image/png",
    providerUsed: "openai",
    modelUsed: "gpt-image-2"
  };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return json(200, {});
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const prompt = body.prompt;
    const imageBase64 = body.imageBase64;
    const mimeType = body.mimeType || "image/jpeg";

    if (!prompt || !imageBase64) {
      return json(400, { error: "Lipseste promptul sau imaginea." });
    }

    const result = await generateWithOpenAI({
      prompt: prompt,
      imageBase64: imageBase64,
      mimeType: mimeType
    });

    return json(200, result);
  } catch (err) {
    console.log("[generate-image] FINAL ERROR " + (err && err.message ? err.message : String(err)));
    return json(500, { error: err && err.message ? err.message : String(err) });
  }
};
