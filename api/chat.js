// /api/chat.js
import { Redis } from '@upstash/redis';

const REQUEST_LIMIT = 10000;
const redis = Redis.fromEnv();

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const { userMessage, chatHistory, apiKey: userProvidedKey } = req.body;
    let keyIncremented = false;

    try {
        if (!userMessage) return res.status(400).json({ error: 'userMessage fehlt.' });
        if (!userProvidedKey) return res.status(401).json({ error: "API Key/License is required." });

        // --- KEY TYPE DETECTION ---
        // 1. Custom Key (BYOK): Startet mit "sk-or-" (OpenRouter Standard)
        const isCustomKey = userProvidedKey.startsWith('sk-or-');
        
        // 2. Trial Key: Exakt 16 Zahlen (wird vom Python-Skript generiert)
        const isTrial = !isCustomKey && userProvidedKey.length === 16 && /^\d+$/.test(userProvidedKey);

        // 3. Synapse License: Alles andere (in der Regel UUIDs)
        const isSynapseLicense = !isCustomKey && !isTrial;

        let tokenToUse = process.env.OPENROUTER_API_KEY;

        // --- LOGIC SWITCH ---
        
        if (isCustomKey) {
            // FALL A: User nutzt eigenen Key
            // -> Keine Redis Checks
            // -> Keine Limits unsererseits
            // -> Wir nutzen den Key des Users für den Fetch
            tokenToUse = userProvidedKey;
            
        } else if (isTrial) {
            // FALL B: Trial Mode
            // -> Python-Addon limitiert auf 5 Versuche lokal.
            // -> Wir überspringen Redis hier (spart Datenbank-Calls).
            // -> Wir zahlen (nutzen Server ENV Key).
            if (!tokenToUse) return res.status(500).json({ error: 'Server Config Error (Trial).' });

        } else if (isSynapseLicense) {
            // FALL C: Standard Synapse Lizenz
            // -> Wir müssen prüfen, ob der Key gültig ist (via Redis Existenz/Limit).
            // -> Wir zahlen.
            
            if (!tokenToUse) return res.status(500).json({ error: 'Server Config Error (License).' });

            const requestCount = await redis.get(userProvidedKey);
            
            // Wenn Key nicht in Redis gefunden wurde -> Ungültig
            if (requestCount === null) {
                return res.status(401).json({ error: "Invalid Synapse License Key." });
            }
            
            // Limit Check
            if (requestCount >= REQUEST_LIMIT) {
                return res.status(429).json({ error: "Monthly limit reached." });
            }
            
            // Zähler erhöhen
            await redis.incr(userProvidedKey);
            keyIncremented = true;
        }

        // --- PREPARE FETCH ---

        const history = Array.isArray(chatHistory) ? chatHistory : [];
        // Falls der User seinen eigenen Key nutzt, nutzen wir trotzdem das Standard-Modell, 
        // es sei denn, du willst das konfigurierbar machen.
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-oss-120b';

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
   - If you use collapsing sections make every new main topic its own collapsing section. For long anwsers there should be 3-5 collapsing sections per answer.
3. **STYLING:**
   - Do NOT use Emojis at all.
   - Use \`<strong>\` for bold text.
   - Use \`<br>\` for line breaks.
   - Highlight medical terms: \`<span style='color: var(--highlight-term);'>Term</span>\`.
   - Highlight concepts: \`<span style='color: var(--highlight-concept);'>Concept</span>\`.

Ensure the explanation is clear, spacious, and medically accurate.` 
        };

        const messagesToSend = [systemPrompt, ...history, { role: "user", content: userMessage }];

        // --- EXECUTE FETCH ---
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenToUse}`, // Hier wird der entsprechende Key genutzt
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000',
                'X-Title': 'Synapse Pro'
            },
            body: JSON.stringify({ model: modelName, messages: messagesToSend })
        });

        if (!response.ok) {
            // Falls es ein Synapse Key war und der Request fehlschlug, Zähler zurücksetzen
            if (keyIncremented) await redis.decr(userProvidedKey);
            
            const err = await response.json().catch(() => ({}));
            
            // Spezielle Fehlermeldung für Custom Keys
            if (isCustomKey && response.status === 401) {
                return res.status(401).json({ error: "Your Custom OpenRouter Key is invalid or has no credits." });
            }

            return res.status(response.status).json({ error: err.error?.message || response.statusText });
        }

        const data = await response.json();
        res.status(200).json(data);

    } catch (error) {
        console.error("API Error:", error);
        if (keyIncremented) await redis.decr(userProvidedKey);
        res.status(500).json({ error: 'Internal Server Error.' });
    }
}
