// /api/chat.js

export default async function handler(req, res) {
    // 1. Nur POST-Anfragen erlauben
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        // 2. Daten aus dem Frontend-Request holen (User-Nachricht und Verlauf)
        const { userMessage, chatHistory } = req.body;

        // Erlaube leere userMessage, da das alte Frontend dies zuließ (vom prompt-input)
        if (userMessage === undefined || userMessage === null) {
             console.log("Warnung: userMessage ist leer oder nicht vorhanden. Wird als leerer String behandelt.");
             // Behandle es als leeren String statt einen Fehler zu werfen
             // return res.status(400).json({ error: 'userMessage fehlt im Request Body.' });
        }
        const actualUserMessage = userMessage || ""; // Fallback auf leeren String

        const history = Array.isArray(chatHistory) ? chatHistory : [];

        // 3. API-Key SICHER aus Umgebungsvariablen holen
        const apiKey = process.env.OPENROUTER_API_KEY;
        // Modell von Umgebungsvariable oder Fallback (wie im Original)
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'mistralai/mixtral-8x7b-instruct';

        if (!apiKey) {
            console.error('FEHLER: OPENROUTER_API_KEY nicht in Umgebungsvariablen gesetzt!');
            return res.status(500).json({ error: 'Serverkonfigurationsfehler.' });
        }

        // 4. System Prompt definieren (wie im Original, fordert Markdown)
        const systemPrompt = {
            role: "system",
            content: "You are Synapse Pro, a helpful assistant for medical students, explaining Anki cards. Always respond in the language used by the user in their last prompt. Format your answers clearly and use **Markdown** for emphasis (like **bold text** using asterisks)." // Geändert zu Markdown
        };

        // 5. Nachrichten-Array für OpenRouter zusammenstellen
        const messagesToSend = [
            systemPrompt,
            ...history, // Vorheriger Verlauf
            { role: "user", content: actualUserMessage } // Aktuelle Nachricht (ggf. leer)
        ];

        // 6. OpenRouter API-Endpunkt und Header vorbereiten (wie im Original)
        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
        const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        const appTitle = 'Synapse Pro Chat (Vercel)';

        // 7. Fetch-Aufruf an OpenRouter (vom Backend!)
        console.log(`Sende Anfrage an OpenRouter (${modelName}) mit Markdown-Anforderung...`);
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
                // Keine expliziten Formatierungs-Parameter, verlasse mich auf System Prompt
            })
        });

        // 8. Antwort von OpenRouter verarbeiten (wie im Original)
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                error: { message: `OpenRouter Fehler: ${response.statusText}` }
            }));
            console.error('OpenRouter API Error:', response.status, errorData);
             return res.status(response.status).json({ error: `API Fehler: ${errorData?.error?.message || response.statusText}` });
        }

        // Erfolgreiche Antwort von OpenRouter (sollte Markdown enthalten)
        const data = await response.json();
        console.log("Erfolgreiche Antwort von OpenRouter erhalten (erwartet Markdown).");

        // 9. Erfolgreiche Antwort an das Frontend zurücksenden
        res.status(200).json(data); // Sende die gesamte Choice-Struktur zurück

    } catch (error) {
        // 10. Generelle Fehler im Backend abfangen
        console.error('Interner Serverfehler in /api/chat:', error);
        res.status(500).json({ error: 'Interner Serverfehler.' });
    }
}
