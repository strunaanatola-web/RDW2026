const { checkAuth } = require("./_auth.js");

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function cleanHint(value, max = 220) {
  return String(value || "").trim().slice(0, max);
}

function buildPrompt(language, context = {}) {
  const buildingHint = cleanHint(context.buildingHint);
  const bucharestHint = !!context.bucharestHint;

  const contextTextEn = [
    bucharestHint ? "The user indicated that the building is located in Bucharest, Romania." : "",
    buildingHint ? `The user provided this possible building/location hint: "${buildingHint}".` : ""
  ].filter(Boolean).join("\n");

  const contextTextRo = [
    bucharestHint ? "Utilizatorul a indicat că această clădire se află în București, România." : "",
    buildingHint ? `Utilizatorul a oferit acest indiciu posibil despre clădire/locație: "${buildingHint}".` : ""
  ].filter(Boolean).join("\n");

  if (language === "en") {
    return `Role: You are an architect with the eye of a historian and urban critic, with deep knowledge of Romanian and European architecture, especially Bucharest architecture.

Your task is to analyze the photograph of a building or urban space. If you recognize the landmark, name it. If you are not sure, do not invent: write that the object cannot be reliably identified from the image.

${contextTextEn ? `Additional user-provided context:\n${contextTextEn}\n\nUse this context as a clue, not as absolute truth. If the image does not visually support the hint, say that the identification cannot be visually confirmed.` : ""}

Write the entire analysis in English, in a sharp, technical but understandable style. Avoid advertising clichés. Do not praise the building; explain it. Be specific about what is visible in the image.

IMPORTANT:
- Do not use asterisks.
- Do not use markdown.
- Section headings must be written on a separate line.
- Answer exactly in the format below.
- Maximum 250-300 words.
- Use English only. Do not write Romanian paragraphs.
- When identifying the building, be explicit about uncertainty if the view is partial, cropped, or ambiguous.

EXACT FORMAT:

TITLE
[Real name of the object, if recognizable; otherwise "Object not reliably identified"] — [a metaphor or short description of its essence]

STYLE AND CONTEXT
[Identify the style and place it in a period. Add a brief international analogy if relevant.]

WHAT IS STRUCTURALLY INTERESTING
[Explain why it looks this way. What technical problem do these forms solve?]

THE DETAIL WORTH NOTICING
[Isolate one specific element and explain its aesthetic or utilitarian function.]

WHAT THE SPACE SAYS AS A WHOLE
[What mood does it convey? What urban or institutional ambition does it suggest?]

URBAN REALITY
[An observation about how that space survives today.]`;
  }

  return `Rol: Ești un arhitect cu ochi de istoric și critic urban, cu cunoștințe profunde despre arhitectura românească și europeană, în special arhitectura Bucureștiului.

Sarcina ta este să analizezi fotografia unei clădiri sau a unui spațiu urban. Dacă recunoști obiectivul, spune numele lui. Dacă nu ești sigur, nu inventa: scrie că obiectivul nu poate fi identificat sigur din imagine.

${contextTextRo ? `Context suplimentar oferit de utilizator:\n${contextTextRo}\n\nFolosește acest context ca indiciu, nu ca adevăr absolut. Dacă imaginea nu confirmă vizual indiciul, spune explicit că identificarea nu poate fi confirmată vizual.` : ""}

Scrie analiza în română, într-un stil percutant, tehnic, dar ușor de înțeles. Evită clișeele publicitare. Nu lăuda clădirea; explic-o. Fii specific la ce vezi în imagine.

IMPORTANT:
- Nu folosi asteriscuri.
- Nu folosi markdown.
- Titlurile secțiunilor trebuie scrise pe o linie separată.
- Răspunde exact în formatul de mai jos.
- Maximum 250-300 de cuvinte.
- Folosește doar limba română.
- Când identifici clădirea, precizează incertitudinea dacă unghiul, crop-ul sau imaginea sunt ambigue.

FORMAT EXACT:

TITLU
[Numele obiectivului real, dacă este recognoscibil; altfel „Obiectiv neidentificat sigur"] — [o metaforă sau descriere scurtă a esenței sale]

STILUL ȘI CONTEXTUL
[Identifică stilul și plasează-l într-o epocă. Fă o scurtă analogie internațională, dacă este relevantă.]

CE E STRUCTURAL INTERESANT
[Explică de ce arată așa. Ce problemă tehnică rezolvă formele respective?]

DETALIUL CARE MERITĂ ATENȚIE
[Izolează un element specific și explică funcția lui estetică sau utilitară.]

CE SPUNE SPAȚIUL ÎN ANSAMBLU
[Ce stare transmite? Ce ambiție urbană sau instituțională sugerează?]

REALITATEA URBANĂ
[O observație despre cum supraviețuiește acel spațiu astăzi.]`;
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text;
  const out = data.output || [];
  for (const item of out) {
    const content = item.content || [];
    for (const part of content) {
      if (part.type === "output_text" && part.text) return part.text;
      if (part.text) return part.text;
    }
  }
  return "";
}

async function analyzeWithOpenAI({ prompt, imageBase64, mimeType }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Lipsește OPENAI_API_KEY.");

  const model = process.env.OPENAI_ANALYSIS_MODEL || "gpt-4.1";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.ARCH_ANALYSIS_TIMEOUT_MS || 55000));

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` }
          ]
        }],
        max_output_tokens: 1000,
        temperature: 0.35
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("Timeout OpenAI analysis");
    throw err;
  }
  clearTimeout(timeout);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || "OpenAI analysis error " + response.status);
  }

  const text = extractOpenAIText(data);
  if (!text) throw new Error("OpenAI nu a returnat text de analiză.");
  return { text, providerUsed: "openai", modelUsed: model };
}

function extractGeminiText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || "").filter(Boolean).join("\n").trim();
}

async function analyzeWithGemini({ prompt, imageBase64, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Lipsește GEMINI_API_KEY.");

  const model = process.env.GEMINI_ANALYSIS_MODEL || "gemini-2.5-pro";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.ARCH_ANALYSIS_TIMEOUT_MS || 55000));

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 1000
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
    if (err.name === "AbortError") throw new Error("Timeout Gemini analysis");
    throw err;
  }
  clearTimeout(timeout);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || "Gemini analysis error " + response.status);
  }

  const text = extractGeminiText(data);
  if (!text) throw new Error("Gemini nu a returnat text de analiză.");
  return { text, providerUsed: "gemini", modelUsed: model };
}

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const auth = checkAuth(event);
    if (!auth.ok) return json(auth.status, { error: auth.error });

    const body = JSON.parse(event.body || "{}");
    const imageBase64 = body.imageBase64;
    const mimeType = body.mimeType || "image/jpeg";
    const language = body.language === "en" || body.analysisLanguage === "en" ? "en" : "ro";
    const buildingHint = cleanHint(body.buildingHint);
    const bucharestHint = body.bucharestHint === true || body.bucharestHint === "true";

    if (!imageBase64) return json(400, { error: language === "en" ? "Missing image." : "Lipsește imaginea." });

    const prompt = buildPrompt(language, { buildingHint, bucharestHint });
    const provider = String(process.env.ARCH_ANALYSIS_PROVIDER || "openai").toLowerCase();

    let result;
    if (provider === "gemini") {
      result = await analyzeWithGemini({ prompt, imageBase64, mimeType });
    } else {
      try {
        result = await analyzeWithOpenAI({ prompt, imageBase64, mimeType });
      } catch (openaiErr) {
        if (!process.env.GEMINI_API_KEY || process.env.ARCH_ANALYSIS_FALLBACK === "false") throw openaiErr;
        console.log("[architectural-analysis] OpenAI failed, Gemini fallback: " + openaiErr.message);
        result = await analyzeWithGemini({ prompt, imageBase64, mimeType });
        result.fallback = true;
        result.primaryError = openaiErr.message;
      }
    }

    return json(200, { text: result.text, language, providerUsed: result.providerUsed, modelUsed: result.modelUsed, fallback: result.fallback || false });
  } catch (err) {
    console.log("[architectural-analysis] FINAL ERROR " + err.message);
    return json(500, { error: err.message });
  }
};
