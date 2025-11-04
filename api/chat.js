--- START OF FILE chat.js ---

// /api/chat.js

// --- NEU: Vercel KV importieren ---
import { kv } from '@vercel/kv';

// --- NEU: Limit pro Schlüssel definieren ---
const REQUEST_LIMIT = 10000; // Z.B. 10.000 Anfragen pro Schlüssel

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
            return res.status(400).json({ error: 'userMessage is missing from the request body.' });
        }
        
        // --- NEUE LIZENZSCHLÜSSEL-PRÜFUNG ---
        // Schritt 2.1: Prüfen, ob überhaupt ein Schlüssel mitgesendet wurde
        if (!userApiKey) {
            return res.status(401).json({ error: "API Key is required. Please enter your Synapse Pro Key." });
        }

        // Schritt 2.2: Den aktuellen Zählerstand für den Schlüssel aus Vercel KV holen
        const requestCount = await kv.get(userApiKey);

        // Schritt 2.3: Prüfen, ob der Schlüssel in der Datenbank existiert.
        // Wenn `kv.get` `null` zurückgibt, wurde der Schlüssel nicht gefunden.
        if (requestCount === null) {
            return res.status(401).json({ error: "Invalid API Key. Please check your key or contact support." });
        }

        // Schritt 2.4: Prüfen, ob das Anfragelimit erreicht wurde.
        if (requestCount >= REQUEST_LIMIT) {
            return res.status(429).json({ error: "Your API Key has reached its request limit for this period." });
        }
        
        // Schritt 2.5: Zähler für den Schlüssel um 1 erhöhen.
        // Dies geschieht, bevor die teure KI-Anfrage gestellt wird.
        await kv.incr(userApiKey); 
        // --- ENDE DER NEUEN LOGIK ---

        // Ab hier bleibt die Logik zur Weiterleitung an OpenRouter fast gleich.
        const history = Array.isArray(chatHistory) ? chatHistory : [];
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini';

        if (!openRouterApiKey) {
            console.error('ERROR: OPENROUTER_API_KEY is not set in environment variables!');
            return res.status(500).json({ error: 'Server configuration error.' });
        }

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
            const errorData = await response.json().catch(() => ({ error: { message: `OpenRouter Error: ${response.statusText}` } }));
            // Wichtig: Den Zähler wieder dekrementieren, wenn die Anfrage fehlschlägt, damit der Nutzer es erneut versuchen kann.
            await kv.decr(userApiKey);
            return res.status(response.status).json({ error: `API Error (${response.status}): ${errorData?.error?.message || response.statusText}` });
        }

        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        console.error('Internal server error in /api/chat:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
}
