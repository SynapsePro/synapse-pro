// /api/chat.js
import admin from 'firebase-admin'; // Requires `npm install firebase-admin`

// --- Initialize Firebase Admin SDK ---
// This needs to be configured with your service account details via environment variables on Vercel
try {
    if (!admin.apps.length) {
        const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
        if (!serviceAccountBase64) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is not set.');
        }
        const serviceAccountJsonString = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
        const serviceAccount = JSON.parse(serviceAccountJsonString);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin SDK initialized in chat API.");
    }
} catch (e) {
    console.error('Firebase Admin SDK initialization error in chat API:', e.message);
}

const db = admin.firestore(); // db will be undefined if admin.initializeApp failed

export default async function handler(req, res) {
    console.log("/api/chat called");

    if (admin.apps.length === 0 || !db) { // Check if Firebase Admin was initialized and db is available
        console.error('Firebase Admin SDK not initialized properly in chat handler.');
        return res.status(500).json({ error: 'Server configuration error (Firebase Admin SDK).' });
    }

    if (req.method !== 'POST') {
        console.log(`Method ${req.method} not allowed.`);
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    // --- 1. Authentication ---
    const authorization = req.headers.authorization;
    if (!authorization || !authorization.startsWith('Bearer ')) {
        console.error("Missing or malformed Authorization header.");
        return res.status(401).json({ error: 'Unauthorized: Missing or malformed token.' });
    }
    const idToken = authorization.split('Bearer ')[1];
    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expired, please log in again.' });
        }
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
    }

    const uid = decodedToken.uid;
    const userEmail = decodedToken.email; // For creating user doc if not exists
    console.log(`User ${uid} (${userEmail}) authenticated for chat.`);

    try {
        const { userMessage, chatHistory } = req.body;
        if (!userMessage) {
            console.error("userMessage missing from request body.");
            return res.status(400).json({ error: 'userMessage fehlt im Request Body.' });
        }
        const history = Array.isArray(chatHistory) ? chatHistory : [];

        // --- 2. User and Credit/Trial Management ---
        const userRef = db.collection('users').doc(uid);
        let userDoc = await userRef.get();
        let userData;

        const now = new Date();
        const todayDateString = now.toISOString().split('T')[0]; // YYYY-MM-DD

        if (!userDoc.exists) {
            console.log(`User document for ${uid} not found. Creating new one.`);
            // First time user, create their document
            const newUserData = {
                email: userEmail,
                credits: 0,
                signupDate: admin.firestore.Timestamp.fromDate(now), // Use server timestamp for signup
                trialRequestsMadeToday: 0,
                lastTrialRequestDate: todayDateString,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };
            await userRef.set(newUserData);
            userData = newUserData;
            // Re-fetch to ensure we have the Timestamps correctly resolved if needed, though newUserData is fine for now
            userDoc = await userRef.get();
            userData = userDoc.data();

        } else {
            userData = userDoc.data();
            console.log(`User document for ${uid} found. Credits: ${userData.credits}, Trial today: ${userData.trialRequestsMadeToday}`);
        }

        // Check and reset daily trial counter if date has changed
        if (userData.lastTrialRequestDate !== todayDateString) {
            console.log(`Resetting trial requests for user ${uid} for new day ${todayDateString}. Old date: ${userData.lastTrialRequestDate}`);
            await userRef.update({
                trialRequestsMadeToday: 0,
                lastTrialRequestDate: todayDateString
            });
            userData.trialRequestsMadeToday = 0; // Update local copy
            userData.lastTrialRequestDate = todayDateString;
        }

        // --- Trial Logic ---
        const signupTimestamp = userData.signupDate; // This is a Firestore Timestamp
        if (!signupTimestamp || typeof signupTimestamp.toDate !== 'function') {
            console.error(`Invalid signupDate for user ${uid}:`, signupTimestamp);
            // Fallback: assume trial is over if signupDate is weird, or set it now
            await userRef.update({ signupDate: admin.firestore.Timestamp.fromDate(now) });
            userData.signupDate = admin.firestore.Timestamp.fromDate(now); // Update local copy
        }
        const signupDate = userData.signupDate.toDate(); // Convert Firestore Timestamp to JS Date
        const daysSinceSignup = (now.getTime() - signupDate.getTime()) / (1000 * 60 * 60 * 24);

        let canProceed = false;
        let usageType = ""; // "trial" or "credit"
        let updateFields = {};

        if (daysSinceSignup <= 7) { // Within 7-day trial period
            console.log(`User ${uid} is within 7-day trial. Days since signup: ${daysSinceSignup.toFixed(2)}`);
            if (userData.trialRequestsMadeToday < 3) {
                canProceed = true;
                usageType = "trial";
                updateFields.trialRequestsMadeToday = admin.firestore.FieldValue.increment(1);
                console.log(`User ${uid} using trial request. Count will be: ${userData.trialRequestsMadeToday + 1}`);
            } else {
                console.log(`User ${uid} daily trial limit reached (3 requests).`);
                return res.status(403).json({ error: 'Daily trial limit reached. Purchase credits or try again tomorrow.' });
            }
        } else { // Trial period over, check for paid credits
            console.log(`User ${uid} trial period over. Days since signup: ${daysSinceSignup.toFixed(2)}`);
            if (userData.credits > 0) {
                canProceed = true;
                usageType = "credit";
                updateFields.credits = admin.firestore.FieldValue.increment(-1);
                console.log(`User ${uid} using paid credit. Remaining will be: ${userData.credits - 1}`);
            } else {
                console.log(`User ${uid} has insufficient credits (0).`);
                return res.status(402).json({ error: 'Insufficient credits. Please purchase more.' }); // 402 Payment Required
            }
        }

        if (!canProceed) {
            // This case should ideally be caught by earlier returns, but as a safeguard.
            console.error(`User ${uid} cannot proceed, though should have been caught. Logic error?`);
            return res.status(403).json({ error: 'Access denied. Check trial status or credits.' });
        }

        // --- 3. API Call to OpenRouter ---
        const apiKey = process.env.OPENROUTER_API_KEY;
        const modelName = process.env.OPENROUTER_MODEL_NAME || 'openai/gpt-4o-mini'; // Your existing model
        const maxTokens = 500; // Your requirement

        if (!apiKey) {
            console.error('CRITICAL: OPENROUTER_API_KEY not set in environment variables!');
            // Do NOT decrement credits/trial if OpenRouter key is missing server-side
            return res.status(500).json({ error: 'Server configuration error (OpenRouter Key).' });
        }

        const systemPrompt = { // Your existing system prompt
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

        const messagesToSend = [
            systemPrompt,
            ...history,
            { role: "user", content: userMessage }
        ];

        const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
        const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'; // Or your consistent local dev URL
        const appTitle = process.env.SITE_TITLE || 'Synapse Pro Chat';

        console.log(`Sending request to OpenRouter for user ${uid}. Model: ${modelName}, Max Tokens: ${maxTokens}`);
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
                max_tokens: maxTokens // Added max_tokens cap
            })
        });

        if (!response.ok) {
            // IMPORTANT: If OpenRouter call fails, DO NOT deduct credits/trial usage yet.
            // The deduction happens *after* a successful call in this implementation.
            // Alternative: Deduct first, then if OpenRouter fails, try to refund/revert (more complex).
            const errorData = await response.json().catch(() => ({
                error: { message: `OpenRouter API Error: ${response.statusText} (Failed to parse error JSON)` }
            }));
            console.error('OpenRouter API Error:', response.status, JSON.stringify(errorData));
            const errorMessage = errorData?.error?.message || response.statusText;
            return res.status(response.status).json({ error: `API Fehler von OpenRouter (${response.status}): ${errorMessage}` });
        }

        const data = await response.json();

        // --- 4. If API call was successful, commit the credit/trial usage ---
        if (Object.keys(updateFields).length > 0) {
            await userRef.update(updateFields);
            console.log(`Successfully updated user ${uid} stats (${usageType}) after successful API call.`);
        }

        // --- 5. Send successful response to frontend ---
        console.log(`Successfully processed chat for user ${uid}. Sending response.`);
        res.status(200).json(data);

    } catch (error) {
        console.error(`Internal Server Error in /api/chat for user ${uid}:`, error);
        res.status(500).json({ error: 'Interner Serverfehler: ' + error.message });
    }
}