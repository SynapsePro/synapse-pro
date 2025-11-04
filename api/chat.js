// /api/chat.js

import { kv } from '@vercel/kv';

const REQUEST_LIMIT = 10000;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    // Zusätzliches Logging, um den Request in den Vercel Logs zu sehen
    console.log("--- New request to /api/chat ---");
    console.log("Request Body:", JSON.stringify(req.body, null, 2));

    const { userMessage, chatHistory, apiKey: userApiKey } = req.body;
    let keyIncremented = false; // Flag, um zu wissen, ob wir dekrementieren müssen

    try {
        if (!userMessage) {
            return res.status(400).json({ error: 'userMessage fehlt im Request Body.' });
        }
        
        if (!userApiKey) {
            return res.status(401).json({ error: "API Key is required. Please enter your Synapse Pro Key." });
        }

        console.log(`Checking key: ${userApiKey.substring(0, 8)}...`);
        const requestCount = await kv.get(userApiKey);
        console.log(`Current count for key: ${requestCount}`);

        if (requestCount === null) {
            return res.status(401).json({ error: "Invalid API Key. Please check your key." });
        }

        if (requestCount >= REQUEST_LIMIT) {
            return res.status(429).json({ error: "Your API Key has reached its request limit." });
        }
        
        await kv.incr(userApiKey);
        keyIncremented = true; // Zähler wurde erhöht

        const history = Array.isArray(chatHistory) ? chatHistory : [];
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini';

        if (!openRouterApiKey) {
            console.error('FEHLER: OPENROUTER_API_KEY nicht in Umgebungsvariablen gesetzt!');
            // Wichtig: Da die Anfrage fehlschlägt, den Zähler zurücksetzen
            await kv.decr(userApiKey); 
            keyIncremented = false;
            return res.status(500).json({ error: 'Serverkonfigurationsfehler.' });
        }

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
            await kv.decr(userApiKey); // Zähler bei OpenRouter-Fehler zurücksetzen
            keyIncremented = false;
            const errorData = await response.json().catch(() => ({ error: { message: `OpenRouter Fehler: ${response.statusText}` } }));
            return res.status(response.status).json({ error: `API Fehler (${response.status}): ${errorData?.error?.message || response.statusText}` });
        }

        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        console.error('Interner Serverfehler in /api/chat:', error);
        // Wenn der Zähler erhöht wurde, bevor der Fehler auftrat, setze ihn zurück.
        if (keyIncremented && userApiKey) {
            await kv.decr(userApiKey);
            console.log("Request count decremented due to internal error.");
        }
        res.status(500).json({ error: 'Interner Serverfehler.' });
    }
}
