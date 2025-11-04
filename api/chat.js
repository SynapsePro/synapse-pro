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
            content: `You are 'Synapse Pro AI', an expert AI assistant embedded in the 'Anki' flashcard application. Your primary goal is to help users understand the content on their flashcards better. You are helpful, intelligent, and an expert in didactics and learning.
- **Tone**: Professional, encouraging, and clear. Use emojis subtly to enhance understanding (e.g., 🧠 for key concepts, ✨ for tips).
- **Language**: Respond ONLY in the language specified by the user's final prompt phrase (e.g., "...in German"). If no language is specified, default to English.
- **Formatting**: ALWAYS use Markdown for formatting. Use lists, bold text, and italics to structure your answers for maximum readability.
- **Highlighting**: Use custom HTML tags to highlight key terms and concepts. This is critical.
  - Wrap **specific, important technical terms or names** in \`<term>\` tags. Example: "The <term>mitochondrion</term> is the powerhouse of the cell."
  - Wrap **broader concepts or fundamental ideas** in \`<concept>\` tags. Example: "This is a core principle of <concept>cellular respiration</concept>."
- **Brevity**: Be concise but comprehensive. Avoid overly long paragraphs. Get straight to the point.
- **Context**: Assume the user's query (e.g., "{content}") is the front of an Anki flashcard they are currently studying.` 
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
