// /api/chat.js

// Using Node.js built-in fetch (available in Node.js >= 18, common on Vercel)
// No need to install node-fetch usually.

export default async function handler(req, res) {
    // 1. Allow only POST requests
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        // 2. Get user message and chat history from request body
        const { userMessage, chatHistory } = req.body;

        // Basic validation
        if (typeof userMessage !== 'string' || userMessage.trim() === '') {
            // Allow technically empty messages if needed for specific prompts from prompt-bar
            // but log a warning if it seems unintentional from user input.
             if (userMessage === undefined || userMessage === null) {
                 console.warn('Received request with missing userMessage.');
                 return res.status(400).json({ error: 'userMessage is missing in the request body.' });
             } // Allow empty strings otherwise, maybe intended.
        }

        // Ensure chatHistory is an array, default to empty if not provided or invalid
        const history = Array.isArray(chatHistory) ? chatHistory : [];

        // 3. Securely get API key and model name from environment variables
        const apiKey = process.env.OPENROUTER_API_KEY;
        // Allow overriding the model via environment variable, default to a capable model
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini'; // Or 'mistralai/mixtral-8x7b-instruct' etc.

        if (!apiKey) {
            console.error('FATAL ERROR: OPENROUTER_API_KEY environment variable is not set!');
            // Return a generic server error to the client, hide specific details
            return res.status(500).json({ error: 'Server configuration error.' });
        }

        // 4. Define the System Prompt - CRITICAL FOR HTML FORMATTING
        // This prompt instructs the AI on its role and MANDATES HTML output.
        const systemPrompt = {
            role: "system",
            content: `You are Synapse Pro, a helpful AI assistant for medical students, primarily explaining Anki flashcards.
ALWAYS respond in the language used by the user in their last prompt.

**CRITICAL FORMATTING INSTRUCTIONS:**
Your *entire* response MUST be formatted using specific HTML tags. Do **NOT** use Markdown (like **bold** or *italic*). Adhere strictly to the following HTML tags:
*   Use \`<strong>\` for general bold text (e.g., main points, terms being defined).
*   Use \`<em>\` for italics where appropriate (e.g., emphasis, foreign words).
*   Use \`<br>\` for all line breaks. Do NOT use newline characters (\`\\n\`).
*   Highlight important medical terms, drug names, or specific entities using: \`<span style='color: var(--highlight-color-term, #005EB8);'>Term</span>\`. Use the CSS variable \`--highlight-color-term\` if possible, otherwise default to #005EB8 (a dark blue).
*   Highlight key concepts, definitions, or short explanatory phrases using: \`<span style='background-color: var(--highlight-bg-concept, #FFFACD);'>Concept phrase</span>\`. Use the CSS variable \`--highlight-bg-concept\` if possible, otherwise default to #FFFACD (light yellow).

**Example Interaction:**
User Prompt: Explain myocardial infarction.
Correct HTML Output Example: \`<strong><span style='color: var(--highlight-color-term, #005EB8);'>Myocardial infarction</span></strong> (MI), commonly known as a <span style='background-color: var(--highlight-bg-concept, #FFFACD);'>heart attack</span>, occurs when blood flow decreases or stops to a part of the heart, causing damage to the heart muscle.<br>Key risk factors include high blood pressure, smoking, diabetes, and high cholesterol.\`

Ensure your explanation is clear, accurate, concise, and medically sound. Maintain the requested HTML format rigorously throughout the entire response.`
        };

        // 5. Construct the messages array for the API call
        const messagesToSend = [
            systemPrompt, // Start with the system's instructions
            ...history,   // Include the previous conversation history
            { role: "user", content: userMessage } // Add the latest user message
        ];

        // 6. Prepare for OpenRouter API call
        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';

        // Recommended headers for OpenRouter, helps them identify traffic source
        // Vercel provides process.env.VERCEL_URL
        const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'; // Fallback for local dev
        const appTitle = 'Synapse Pro Chat (Vercel)';

        // 7. Make the fetch request FROM THE BACKEND to OpenRouter
        console.log(`Sending request to OpenRouter with model: ${modelName}`);
        const response = await fetch(openRouterUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`, // The secure API key
                'Content-Type': 'application/json',
                'HTTP-Referer': siteUrl, // Your site URL
                'X-Title': appTitle      // Your application title
            },
            body: JSON.stringify({
                model: modelName,
                messages: messagesToSend,
                // Optional parameters (can be added here):
                // temperature: 0.7,
                // max_tokens: 1000,
                // stream: false // Set to true if you want streaming responses
            })
        });

        // 8. Process the response from OpenRouter
        // Check for API errors (non-2xx status codes)
        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json(); // Try to get error details from OpenRouter
            } catch (e) {
                // If response is not JSON or empty
                errorData = { error: { message: `OpenRouter API Error: ${response.statusText}` } };
            }
            console.error('OpenRouter API Error:', response.status, errorData);
            // Send OpenRouter's status code and a generic message back to frontend
            return res.status(response.status).json({ error: `API Error: ${errorData?.error?.message || response.statusText}` });
        }

        // Parse the successful JSON response from OpenRouter
        const data = await response.json();
        console.log('Received successful response from OpenRouter.');

        // Basic check if the response format is as expected
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('Unexpected response structure from OpenRouter:', data);
            return res.status(500).json({ error: 'Invalid response format received from AI provider.' });
        }

        // 9. Send the successful response back to the frontend
        // The frontend expects the 'data' object which contains 'choices', etc.
        res.status(200).json(data);

    } catch (error) {
        // 10. Catch any unexpected errors during backend processing
        console.error('Internal Server Error in /api/chat:', error);
        res.status(500).json({ error: 'Internal Server Error.' });
    }
}
