// /api/chat.js

// GEÄNDERT: Wir importieren jetzt das korrekte Paket, das in deiner package.json steht.
import { Redis } from '@upstash/redis';

const REQUEST_LIMIT = 10000;

// GEÄNDERT: Wir initialisieren den Redis-Client.
// Dieser Client verwendet automatisch die `UPSTASH_...`-Umgebungsvariablen von Vercel.
const redis = Redis.fromEnv();

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const { userMessage, chatHistory, apiKey: userApiKey } = req.body;
    let keyIncremented = false; // Flag, um zu wissen, ob wir dekrementieren müssen

    try {
        if (!userMessage) {
            return res.status(400).json({ error: 'userMessage fehlt im Request Body.' });
        }
        
        if (!userApiKey) {
            return res.status(401).json({ error: "API Key is required. Please enter your Synapse Pro Key." });
        }

        // GEÄNDERT: Alle Aufrufe von `kv` werden durch `redis` ersetzt.
        const requestCount = await redis.get(userApiKey);

        if (requestCount === null) {
            return res.status(401).json({ error: "Invalid API Key. Please check your key." });
        }

        if (requestCount >= REQUEST_LIMIT) {
            return res.status(429).json({ error: "Your API Key has reached its request limit." });
        }
        
        await redis.incr(userApiKey);
        keyIncremented = true; // Zähler wurde erhöht

        const history = Array.isArray(chatHistory) ? chatHistory : [];
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini';

        if (!openRouterApiKey) {
            console.error('FEHLER: OPENROUTER_API_KEY nicht in Umgebungsvariablen gesetzt!');
            await redis.decr(userApiKey); 
            keyIncremented = false;
            return res.status(500).json({ error: 'Serverkonfigurationsfehler.' });
        }

        // Der System-Prompt bleibt unverändert.
        const systemPrompt = { 
            role: "system", 
            content: `You are Synapse Pro, a helpful assistant for medical students, explaining Anki cards. Always respond in the language used by the user in their last prompt.
**CRITICAL FORMATTING INSTRUCTION:** Format your *entire* response using standard HTML tags for emphasis and highlighting specific terms/concepts with colors. Do **NOT** use Markdown syntax like **bold** or *italic*. You MUST use the specified HTML tags. Do **NOT** use background highlighting.
*   Use \`<strong>\` for general bold text (like headings or main points).
*   Use \`<em>\` for italics if needed.
*   Use \`<br>\` for line breaks instead of newline characters.
*   Highlight important medical terms/drugs using \`<span style='color: var(--highlight-color-term, #005EB8);'>Term</span>\`. (Use the CSS variable --highlight-color-term if possible, otherwise default blue)
*   Highlight key concepts or definitions using \`<span style='color: var(--highlight-color-concept, #28a745);'>Concept</span>\`. (Use the CSS variable --highlight-color-concept if possible, otherwise default green)
Example Input: **HIV** causes **AIDS**.
Example CORRECT HTML Output: \`<strong><span style='color: var(--highlight-color-term, #005EB8);'>HIV</span></strong> causes <span style='color: var(--highlight-color-concept, #28a745);'>AIDS</span>.<br>\`
Ensure the explanation remains clear, accurate, and medically sound.` 
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
            await redis.decr(userApiKey);
            keyIncremented = false;
            const errorData = await response.json().catch(() => ({ error: { message: `OpenRouter Fehler: ${response.statusText}` } }));
            return res.status(response.status).json({ error: `API Fehler (${response.status}): ${errorData?.error?.message || response.statusText}` });
        }

        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        console.error('Interner Serverfehler in /api/chat:', error);
        if (keyIncremented && userApiKey) {
            await redis.decr(userApiKey);
        }
        res.status(500).json({ error: 'Interner Serverfehler.' });
    }
}
