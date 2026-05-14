const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

async function generateWithOpenAI({ prompt, imageBase64, mimeType }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Lipsește OPENAI_API_KEY în Netlify Environment Variables.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  console.log(
    `[generate-image] OpenAI ONLY start model=gpt-image-2 size=1024x1024 timeout=45000ms imageBase64Length=${imageBase64.length}`
  );

  const imageBuffer = Buffer.from(imageBase64, "base64");

  const blob = new Blob([imageBuffer], {
    type: mimeType || "image/jpeg"
  });

  const formData = new FormData();

  formData.append("model", "gpt-image-2");
  formData.append("prompt", prompt);
  formData.append("size", "1024x1024");
  formData.append("image", blob, "building.jpg");

  let response;

  try {
    response = await fetch(
      "https://api.openai.com/v1/images/edits",
      {
};
