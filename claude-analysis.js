const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: CORS_HEADERS, body: "{}" };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Lipsește CLAUDE_API_KEY în Netlify Environment Variables." })
      };
    }

    const body = JSON.parse(event.body || "{}");
    const imageBase64 = body.imageBase64;
    const mimeType = body.mimeType || "image/jpeg";

    if (!imageBase64) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Lipsește imaginea." })
      };
    }

    const prompt = `Rol: Ești un arhitect cu ochi de istoric și critic urban, cu cunoștințe profunde despre arhitectura românească și europeană.

Sarcina ta este să analizezi fotografia unei clădiri sau a unui spațiu urban. Dacă recunoști obiectivul, spune numele lui. Dacă nu ești sigur, nu inventa: scrie că obiectivul nu poate fi identificat sigur din imagine.

Scrie analiza în română, într-un stil percutant, tehnic, dar ușor de înțeles. Evită clișeele publicitare. Nu lăuda clădirea; explic-o. Fii specific la ce vezi în imagine.

IMPORTANT:
- Nu folosi asteriscuri.
- Nu folosi markdown.
- Titlurile secțiunilor trebuie scrise pe o linie separată.
- Răspunde exact în formatul de mai jos.
- Maximum 250-300 de cuvinte.

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

    const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

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
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: imageBase64
                }
              },
              {
                type: "text",
                text: prompt
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: data.error?.message || "Claude API error",
          details: data
        })
      };
    }

    const text = data.content?.find(part => part.type === "text")?.text || "";

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ text })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
