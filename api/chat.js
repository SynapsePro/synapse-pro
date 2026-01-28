// /api/chat.js
import { Redis } from '@upstash/redis';

const REQUEST_LIMIT = 10000;
const redis = Redis.fromEnv();

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const { userMessage, chatHistory, apiKey: userApiKey } = req.body;
    let keyIncremented = false;

    try {
        if (!userMessage) return res.status(400).json({ error: 'userMessage fehlt.' });
        if (!userApiKey) return res.status(401).json({ error: "API Key is required." });

        const requestCount = await redis.get(userApiKey);
        if (requestCount === null) return res.status(401).json({ error: "Invalid API Key." });
        if (requestCount >= REQUEST_LIMIT) return res.status(429).json({ error: "Limit reached." });
        
        await redis.incr(userApiKey);
        keyIncremented = true;

        const history = Array.isArray(chatHistory) ? chatHistory : [];
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-oss-120b';

        if (!openRouterApiKey) {
            await redis.decr(userApiKey);
            return res.status(500).json({ error: 'Server Config Error.' });
        }

        // GEÄNDERTER PROMPT: Keine Emojis, striktes HTML
        const systemPrompt = { 
            role: "system", 
            content: `You are Synapse Pro, a study assistant. Always respond in the language used by the user.

**FORMATTING RULES:**
1. Use standard HTML tags. NO Markdown.
2. **COLLAPSIBLE SECTIONS:** Structure the explanation using HTML \`<details>\` and \`<summary>\`.
   - Use \`<details>\` for the container.
   - Use \`<summary>\` for the heading. **Do NOT use Emojis in the summary.** Keep headings short and professional.
   - Inside details, put the content.
   - Only use the collapsing sections for long explanations, if the answer is really short dont use collapsing sections.
3. **STYLING:**
   - Do NOT use Emojis at all.
   - Use \`<strong>\` for bold text.
   - Use \`<br>\` for line breaks.
   - Highlight medical terms: \`<span style='color: var(--highlight-term);'>Term</span>\`.
   - Highlight concepts: \`<span style='color: var(--highlight-concept);'>Concept</span>\`.

Ensure the explanation is clear, spacious, and medically accurate.` 
        };

        const messagesToSend = [systemPrompt, ...history, { role: "user", content: userMessage }];

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openRouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000',
                'X-Title': 'Synapse Pro'
            },
            body: JSON.stringify({ model: modelName, messages: messagesToSend })
        });

        if (!response.ok) {
            await redis.decr(userApiKey);
            const err = await response.json().catch(() => ({}));
            return res.status(response.status).json({ error: err.error?.message || response.statusText });
        }

        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        if (keyIncremented) await redis.decr(userApiKey);
        res.status(500).json({ error: 'Internal Server Error.' });
    }
}
