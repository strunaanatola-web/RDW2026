const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function buildPrompt(language) {
  if (language === "en") {
    return `Role: You are an architect with the eye of a historian and urban critic, with deep knowledge of Romanian and European architecture.

Your task is to analyze the photograph of a building or urban space. If you recognize the landmark, name it. If you are not sure, do not invent: write that the object cannot be reliably identified from the image.

Write the entire analysis in English, in a sharp, technical but understandable style. Avoid advertising clichés. Do not praise the building; explain it. Be specific about what is visible in the image.

IMPORTANT:
- Do not use asterisks.
- Do not use markdown.
- Section headings must be written on a separate line.
- Answer exactly in the format below.
- Maximum 250-300 words.
- Use English only. Do not write Romanian paragraphs.

EXACT FORMAT:

TITLE
[Real name of the object, if recognizable; otherwise “Object not reliably identified”] — [a metaphor or short description of its essence]

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

  return `Rol: Ești un arhitect cu ochi de istoric și critic urban, cu cunoștințe profunde despre arhitectura românească și europeană.

Sarcina ta este să analizezi fotografia unei clădiri sau a unui spațiu urban. Dacă recunoști obiectivul, spune numele lui. Dacă nu ești sigur, nu inventa: scrie că obiectivul nu poate fi identificat sigur din imagine.

Scrie analiza în română, într-un stil percutant, tehnic, dar ușor de înțeles. Evită clișeele publicitare. Nu lăuda clădirea; explic-o. Fii specific la ce vezi în imagine.

IMPORTANT:
- Nu folosi asteriscuri.
- Nu folosi markdown.
- Titlurile secțiunilor trebuie scrise pe o linie separată.
- Răspunde exact în formatul de mai jos.
- Maximum 250-300 de cuvinte.
- Folosește doar limba română.

FORMAT EXACT:

TITLU
[Numele obiectivului real, dacă este recognoscibil; altfel „Obiectiv neidentificat sigur”] — [o metaforă sau descriere scurtă a esenței sale]

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

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) return json(500, { error: "Lipsește ANTHROPIC_API_KEY în Netlify Environment Variables." });

    const body = JSON.parse(event.body || "{}");
    const imageBase64 = body.imageBase64;
    const mimeType = body.mimeType || "image/jpeg";
    const language = body.language === "en" || body.analysisLanguage === "en" ? "en" : "ro";

    if (!imageBase64) return json(400, { error: language === "en" ? "Missing image." : "Lipsește imaginea." });

    const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";
    const prompt = buildPrompt(language);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0.5,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json(response.status, { error: data.error?.message || "Claude API error", details: data });
    }

    const text = data.content?.find(part => part.type === "text")?.text || "";
    return json(200, { text, language, providerUsed: "anthropic", modelUsed: model });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
