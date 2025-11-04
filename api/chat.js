import { kv } from '@vercel/kv';

const REQUEST_LIMIT = 10000;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        const { userMessage, chatHistory, apiKey: userApiKey } = req.body;

        if (!userMessage) {
            return res.status(400).json({ error: 'userMessage is required.' });
        }
        
        if (!userApiKey) {
            // Diese Meldung sollte der Nutzer jetzt nur sehen, wenn localStorage leer ist
            // und er versucht, eine Anfrage zu senden, bevor er einen Schlüssel eingibt.
            return res.status(401).json({ error: "Pro Key not found. Please enter your key below and save it." });
        }

        const requestCount = await kv.get(userApiKey);

        if (requestCount === null) {
            return res.status(401).json({ error: "Invalid API Key. Please check your key or purchase a new one." });
        }

        if (requestCount >= REQUEST_LIMIT) {
            return res.status(429).json({ error: "Your API Key has reached its request limit." });
        }
        
        await kv.incr(userApiKey);

        const history = Array.isArray(chatHistory) ? chatHistory : [];
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini';

        if (!openRouterApiKey) {
            console.error('ERROR: OPENROUTER_API_KEY not set in environment variables!');
            return res.status(500).json({ error: 'Server configuration error.' });
        }

        const systemPrompt = {
            role: "system",
            content: `You are Synapse Pro...` // Dein ganzer System-Prompt hier
        };

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
            const errorData = await response.json().catch(() => ({ error: { message: `OpenRouter Error: ${response.statusText}` } }));
            return res.status(response.status).json({ error: `API Error (${response.status}): ${errorData?.error?.message || response.statusText}` });
        }

        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        console.error('Internal server error in /api/chat:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
}
