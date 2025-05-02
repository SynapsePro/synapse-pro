// /api/chat.js

// Node.js >= 18 hat fetch eingebaut.
export default async function handler(req, res) {
    // 1. Nur POST-Anfragen erlauben
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        // 2. Daten aus dem Frontend-Request holen
        const { userMessage, chatHistory } = req.body;

        // userMessage kann jetzt ein String oder ein Objekt sein
        if (userMessage === undefined || userMessage === null) {
             // Erlaube leere Nachrichten, falls z.B. nur der Verlauf gesendet wird (unwahrscheinlich hier)
             // oder wenn der Prompt-Input leer ausgelöst wird.
             console.log("Warnung: userMessage ist leer oder nicht vorhanden.");
             // return res.status(400).json({ error: 'userMessage fehlt im Request Body.' });
        }

        const history = Array.isArray(chatHistory) ? chatHistory : [];

        // 3. API-Key SICHER aus Umgebungsvariablen holen
        const apiKey = process.env.OPENROUTER_API_KEY;
        // Modellnamen aus Env Vars holen, mit dem aus test.html als Fallback
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini';

        if (!apiKey) {
            console.error('FEHLER: OPENROUTER_API_KEY nicht in Umgebungsvariablen gesetzt!');
            return res.status(500).json({ error: 'Serverkonfigurationsfehler.' });
        }

        // 4. System Prompt definieren (HTML-Version aus test.html)
        const systemPrompt = {
            role: "system",
            content: `You are Synapse Pro, a helpful assistant for medical students, explaining Anki cards. Always respond in the language used by the user in their last prompt.
**CRITICAL FORMATTING INSTRUCTION:** Format your *entire* response using standard HTML tags for emphasis and highlighting. Do **NOT** use Markdown syntax like **bold** or *italic*. You MUST use the specified HTML tags.
*   Use \`<strong>\` for general bold text (like headings or main points).
*   Use \`<em>\` for italics if needed.
*   Use \`<br>\` for line breaks instead of newline characters.
*   Highlight important medical terms/drugs using \`<span style='color: var(--highlight-color-term, #005EB8);'>Term</span>\`. (Use the CSS variable --highlight-color-term if possible, otherwise default blue)
*   Highlight key concepts or definitions using \`<span style='background-color: var(--highlight-bg-concept, #FFFACD);'>Concept</span>\`. (Use the CSS variable --highlight-bg-concept if possible, otherwise default light yellow)
Example Input: **HIV** causes **AIDS**.
Example CORRECT HTML Output: \`<strong><span style='color: var(--highlight-color-term, #005EB8);'>HIV</span></strong> causes <span style='background-color: var(--highlight-bg-concept, #FFFACD);'>AIDS</span>.<br>\`
Ensure the explanation remains clear, accurate, and medically sound.`
        };

        // 5. Aktuelle User-Nachricht für OpenRouter formatieren
        let currentUserMessageObject;
        if (typeof userMessage === 'string') {
            // Einfache Textnachricht
            currentUserMessageObject = { role: "user", content: userMessage };
        } else if (typeof userMessage === 'object' && userMessage !== null && userMessage.type === 'multimodal') {
            // Multimodale Nachricht vom Frontend (enthält text und imageUrl)
            currentUserMessageObject = {
                role: "user",
                content: [
                    { type: "text", text: userMessage.text },
                    { type: "image_url", image_url: { url: userMessage.imageUrl } }
                ]
            };
             // Prüfen, ob das gewählte Modell multimodal ist. Wenn nicht, könnte es fehlschlagen.
             // Ggf. Logik hinzufügen, um nur den Text zu senden, wenn das Modell nicht multimodal ist.
             console.log(`Hinweis: Multimodale Nachricht wird an Modell ${modelName} gesendet.`);
        } else if (userMessage === "" || userMessage === null) {
            // Erlaube leere Nachricht (z.B. von prompt-input)
            currentUserMessageObject = { role: "user", content: "" };
            console.log("Leere User-Nachricht wird gesendet.");
        }
        else {
            console.error("Unerwartetes Format für userMessage:", userMessage);
            return res.status(400).json({ error: 'Ungültiges Format für userMessage.' });
        }


        // 6. Nachrichten-Array für OpenRouter zusammenstellen
        const messagesToSend = [
            systemPrompt,
            ...history, // Vorheriger Verlauf
            currentUserMessageObject // Aktuelle formatierte Nachricht
        ];

        // 7. OpenRouter API-Endpunkt und Header vorbereiten
        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
        const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'; // Vercel URL oder localhost
        const appTitle = 'Synapse Pro Chat (Vercel)'; // App-Titel

        // 8. Fetch-Aufruf an OpenRouter (vom Backend!)
        console.log(`Sende Anfrage an OpenRouter (${modelName})...`);
        const response = await fetch(openRouterUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': siteUrl,
                'X-Title': appTitle
            },
            body: JSON.stringify({
                model: modelName,
                messages: messagesToSend,
                // Evtl. max_tokens, temperature etc. hier hinzufügen
                // max_tokens: 1000,
                // temperature: 0.7
            })
        });

        // 9. Antwort von OpenRouter verarbeiten
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ // Fallback
                error: { message: `OpenRouter Fehler: ${response.statusText}` }
            }));
            console.error('OpenRouter API Error:', response.status, JSON.stringify(errorData));
             return res.status(response.status).json({ error: `API Fehler: ${errorData?.error?.message || response.statusText}` });
        }

        // Erfolgreiche Antwort von OpenRouter
        const data = await response.json();
        console.log("Erfolgreiche Antwort von OpenRouter erhalten.");

        // 10. Erfolgreiche Antwort (sollte HTML enthalten) an das Frontend zurücksenden
        res.status(200).json(data); // Sende die gesamte Choice-Struktur zurück

    } catch (error) {
        // 11. Generelle Fehler im Backend abfangen
        console.error('Interner Serverfehler in /api/chat:', error);
        res.status(500).json({ error: 'Interner Serverfehler.' });
    }
}
