// /api/chat.js

export default async function handler(req, res) {
    // 1. Allow only POST requests
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        // 2. Get user message and chat history from request body
        const { userMessage, chatHistory } = req.body;

        // Allow empty string from automation, but error if null/undefined
        if (userMessage === undefined || userMessage === null) {
            console.warn('Received request with missing userMessage.');
            return res.status(400).json({ error: 'userMessage is missing.' });
        }

        const history = Array.isArray(chatHistory) ? chatHistory : [];

        // 3. Securely get API key and model name from environment variables
        const apiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini'; // Or 'mistralai/mixtral-8x7b-instruct' etc.

        if (!apiKey) {
            console.error('FATAL ERROR: OPENROUTER_API_KEY environment variable not set!');
            return res.status(500).json({ error: 'Server configuration error.' });
        }

        // 4. Define the System Prompt - *CRITICAL FOR HTML OUTPUT*
        const systemPrompt = {
            role: "system",
            content: `You are Synapse Pro, a helpful AI assistant for medical students, primarily explaining Anki flashcards.
ALWAYS respond in the language used by the user in their last prompt. Do NOT switch languages.

**CRITICAL FORMATTING INSTRUCTIONS:**
Your *entire* response MUST be formatted using specific HTML tags. Do **NOT** use Markdown (like **bold** or *italic*). Adhere strictly to the following HTML tags:
*   Use \`<strong>\` for general bold text (e.g., main points, terms being defined).
*   Use \`<em>\` for italics where appropriate (e.g., emphasis, foreign words).
*   Use \`<br>\` for ALL line breaks. Do NOT use newline characters (\`\\n\`). Single line breaks should be one <br>, double line breaks should be <br><br>.
*   Highlight important medical terms, drug names, or specific entities using: \`<span style='color: var(--highlight-color-term, #005EB8);'>Term</span>\`. Use the CSS variable \`--highlight-color-term\` if possible, otherwise default to #005EB8.
*   Highlight key concepts, definitions, or short explanatory phrases using: \`<span style='background-color: var(--highlight-bg-concept, #FFFACD);'>Concept phrase</span>\`. Use the CSS variable \`--highlight-bg-concept\` if possible, otherwise default to #FFFACD.

**Example Interaction:**
User Prompt: Explain myocardial infarction briefly.
Correct HTML Output Example: \`<strong><span style='color: var(--highlight-color-term, #005EB8);'>Myocardial infarction</span></strong> (MI) is commonly known as a <span style='background-color: var(--highlight-bg-concept, #FFFACD);'>heart attack</span>.<br>It happens when blood flow to the heart muscle is severely reduced or stopped, causing tissue damage.\`

Ensure your explanation is clear, accurate, concise, and medically sound. Maintain the requested HTML format rigorously throughout the ENTIRE response.`
        };


        // 5. Construct the messages array for the API call
        const messagesToSend = [
            systemPrompt,
            ...history,
            { role: "user", content: userMessage }
        ];

        // 6. Prepare for OpenRouter API call
        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
        const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        const appTitle = 'Synapse Pro Chat (Vercel)';

        // 7. Make the fetch request FROM THE BACKEND to OpenRouter
        console.log(`Sending request to OpenRouter with model: ${modelName}, message: "${userMessage.substring(0,50)}..."`);
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
                // temperature: 0.7, // Optional params
            })
        });

        // 8. Process the response from OpenRouter
        if (!response.ok) {
            let errorData;
            try { errorData = await response.json(); } catch (e) { errorData = { error: { message: `OpenRouter API Error: ${response.statusText}` } }; }
            console.error('OpenRouter API Error:', response.status, errorData);
            return res.status(response.status).json({ error: `API Error: ${errorData?.error?.message || response.statusText}` });
        }

        const data = await response.json();
        console.log('Received successful response from OpenRouter.');

        if (!data.choices || !data.choices[0] || !data.choices[0].message || typeof data.choices[0].message.content !== 'string') {
             console.error('Unexpected response structure from OpenRouter:', data);
             return res.status(500).json({ error: 'Invalid response format from AI provider.' });
         }
         // Log the actual response content for debugging HTML issues
         console.log("Bot Reply (HTML):", data.choices[0].message.content.substring(0, 200) + "...");


        // 9. Send the successful response back to the frontend
        res.status(200).json(data);

    } catch (error) {
        // 10. Catch any unexpected errors during backend processing
        console.error('Internal Server Error in /api/chat:', error);
        res.status(500).json({ error: 'Internal Server Error.' });
    }
}
