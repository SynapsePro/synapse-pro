// /api/chat.js

// Node.js >= 18 hat fetch eingebaut. Für ältere Versionen ggf. 'node-fetch' installieren.
// const fetch = require('node-fetch'); // Nur wenn Node < 18 und lokal getestet wird

export default async function handler(req, res) {
    // 1. Nur POST-Anfragen erlauben
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        // 2. Daten aus dem Frontend-Request holen (User-Nachricht und Verlauf)
        const { userMessage, chatHistory } = req.body;

        if (!userMessage) {
            return res.status(400).json({ error: 'userMessage fehlt im Request Body.' });
        }
        // chatHistory ist optional, kann auch ein leeres Array sein
        const history = Array.isArray(chatHistory) ? chatHistory : [];

        // 3. API-Key SICHER aus Umgebungsvariablen holen
        const apiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'mistralai/mixtral-8x7b-instruct'; // Modell optional auch aus Env Vars

        if (!apiKey) {
            console.error('FEHLER: OPENROUTER_API_KEY nicht in Umgebungsvariablen gesetzt!');
            // Gib keine detaillierte Fehlermeldung an den Client zurück
            return res.status(500).json({ error: 'Serverkonfigurationsfehler.' });
        }

        // 4. System Prompt definieren (könnte auch aus Frontend kommen, aber hier sicherer)
        const systemPrompt = {
            role: "system",
            content: "You are Synapse Pro, a helpful assistant for medical students, explaining Anki cards. Always respond in the language used by the user in their last prompt. Format your answers clearly and use Markdown for emphasis."
        };

        // 5. Nachrichten-Array für OpenRouter zusammenstellen
        const messagesToSend = [
            systemPrompt,
            ...history, // Vorheriger Verlauf
            { role: "user", content: userMessage } // Aktuelle Nachricht
        ];

        // 6. OpenRouter API-Endpunkt und Header vorbereiten
        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
        // Vercel stellt die URL zur Verfügung, nützlich für Header
        const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        const appTitle = 'Synapse Pro Chat (Vercel)';

        // 7. Fetch-Aufruf an OpenRouter (vom Backend!)
        const response = await fetch(openRouterUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`, // Der geheime Key!
                'Content-Type': 'application/json',
                // Empfohlene Header für OpenRouter:
                'HTTP-Referer': siteUrl,
                'X-Title': appTitle
            },
            body: JSON.stringify({
                model: modelName,
                messages: messagesToSend,
                // Weitere Parameter wie temperature, max_tokens etc. könnten hier hin
            })
        });

        // 8. Antwort von OpenRouter verarbeiten
        // Fehler von OpenRouter abfangen
        if (!response.ok) {
            // Versuche, die Fehlermeldung von OpenRouter zu lesen
            const errorData = await response.json().catch(() => ({ // Fallback, falls Antwort kein JSON ist
                error: { message: `OpenRouter Fehler: ${response.statusText}` }
            }));
            console.error('OpenRouter API Error:', response.status, errorData);
             // Gib den Status von OpenRouter und eine generische Fehlermeldung zurück
             return res.status(response.status).json({ error: `API Fehler: ${errorData?.error?.message || response.statusText}` });
        }

        // Erfolgreiche Antwort von OpenRouter
        const data = await response.json();

        // 9. Erfolgreiche Antwort an das Frontend zurücksenden
        res.status(200).json(data);

    } catch (error) {
        // 10. Generelle Fehler im Backend abfangen
        console.error('Interner Serverfehler in /api/chat:', error);
        res.status(500).json({ error: 'Interner Serverfehler.' });
    }
}
