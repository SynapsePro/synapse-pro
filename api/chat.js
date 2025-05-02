// /api/chat.js

// Node.js >= 18 hat fetch eingebaut. Für ältere Versionen ggf. 'node-fetch' installieren.
// import fetch from 'node-fetch'; // Nur wenn Node < 18

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
        // Standardmodell bleibt gpt-4o-mini oder was in der Env Var steht
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini';

        if (!apiKey) {
            console.error('FEHLER: OPENROUTER_API_KEY nicht in Umgebungsvariablen gesetzt!');
            return res.status(500).json({ error: 'Serverkonfigurationsfehler.' });
        }

        // 4. System Prompt definieren - UPDATED
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

        // 5. Nachrichten-Array für OpenRouter zusammenstellen
        const messagesToSend = [
            systemPrompt,
            ...history, // Vorheriger Verlauf
            { role: "user", content: userMessage } // Aktuelle Nachricht (nur Text)
        ];

        // 6. OpenRouter API-Endpunkt und Header vorbereiten
        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
        const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        const appTitle = process.env.SITE_TITLE || 'Synapse Pro Chat';

        // 7. Fetch-Aufruf an OpenRouter (vom Backend!)
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
                // temperature: 0.7, // Beispiel für weitere Parameter
            })
        });

        // 8. Antwort von OpenRouter verarbeiten
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                error: { message: `OpenRouter Fehler: ${response.statusText}` }
            }));
            console.error('OpenRouter API Error:', response.status, errorData);
             const errorMessage = errorData?.error?.message || response.statusText;
             return res.status(response.status).json({ error: `API Fehler (${response.status}): ${errorMessage}` });
        }

        const data = await response.json();

        // 9. Erfolgreiche Antwort an das Frontend zurücksenden
        res.status(200).json(data);

    } catch (error) {
        // 10. Generelle Fehler im Backend abfangen
        console.error('Interner Serverfehler in /api/chat:', error);
        res.status(500).json({ error: 'Interner Serverfehler.' });
    }
}
