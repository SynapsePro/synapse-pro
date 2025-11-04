// /api/chat.js

// --- NEU: Vercel KV importieren ---
import { kv } from '@vercel/kv';

// --- NEU: Limit pro Schlüssel definieren ---
const REQUEST_LIMIT = 10000;

export default async function handler(req, res) {
    // 1. Nur POST-Anfragen erlauben
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        // 2. Daten aus dem Frontend-Request holen (inkl. userApiKey)
        const { userMessage, chatHistory, apiKey: userApiKey } = req.body;

        if (!userMessage) {
            return res.status(400).json({ error: 'userMessage fehlt im Request Body.' });
        }
        
        // --- NEUE LIZENZSCHLÜSSEL-PRÜFUNG ---
        if (!userApiKey) {
            return res.status(401).json({ error: "API Key is required. Please enter your Synapse Pro Key." });
        }

        const requestCount = await kv.get(userApiKey);

        if (requestCount === null) {
            return res.status(401).json({ error: "Invalid API Key. Please check your key." });
        }

        if (requestCount >= REQUEST_LIMIT) {
            return res.status(429).json({ error: "Your API Key has reached its request limit." });
        }
        
        await kv.incr(userApiKey); // Zähler erhöhen
        // --- ENDE DER NEUEN LOGIK ---

        const history = Array.isArray(chatHistory) ? chatHistory : [];
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini';

        if (!openRouterApiKey) {
            console.error('FEHLER: OPENROUTER_API_KEY nicht in Umgebungsvariablen gesetzt!');
            return res.status(500).json({ error: 'Serverkonfigurationsfehler.' });
        }

        // Der System Prompt bleibt exakt gleich...
        const systemPrompt = { /* ... Dein ganzer System-Prompt-Text hier ... */ };

        const messagesToSend = [systemPrompt, ...history, { role: "user", content: userMessage }];
        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
        const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        const appTitle = process.env.SITE_TITLE || 'Synapse Pro Chat';

        const response = await fetch(openRouterUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': siteUrl,
                'X-Title': appTitle
            },
            body: JSON.stringify({
                model: modelName,
                messages: messagesToSend,
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: `OpenRouter Fehler: ${response.statusText}` } }));
            return res.status(response.status).json({ error: `API Fehler (${response.status}): ${errorData?.error?.message || response.statusText}` });
        }

        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        console.error('Interner Serverfehler in /api/chat:', error);
        res.status(500).json({ error: 'Interner Serverfehler.' });
    }
}