// api/create-checkout-session.js
import Stripe from 'stripe'; // Requires `npm install stripe` which you did
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
        console.log("Firebase Admin SDK initialized in create-checkout-session.");
    }
} catch (e) {
    console.error('Firebase Admin SDK initialization error in create-checkout-session:', e.message);
    // We don't return an error response here immediately,
    // as the handler needs to run to send a 500 if this fails.
}

// --- Initialize Stripe ---
// This needs your Stripe Secret Key from environment variables on Vercel
let stripe;
try {
    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY environment variable is not set.');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    console.log("Stripe SDK initialized.");
} catch (e) {
    console.error('Stripe SDK initialization error:', e.message);
}


export default async function handler(req, res) {
    console.log("/api/create-checkout-session called");

    if (!stripe || admin.apps.length === 0) {
        console.error("Stripe or Firebase Admin SDK not initialized properly.");
        return res.status(500).json({ error: "Server configuration error. SDKs not initialized." });
    }

    if (req.method !== 'POST') {
        console.log(`Method ${req.method} not allowed.`);
        res.setHeader('Allow', 'POST');
        return res.status(405).end('Method Not Allowed');
    }

    const { priceId, userId } = req.body;
    console.log("Request body:", req.body);

    if (!priceId || !userId) {
        console.error("Missing priceId or userId in request body.");
        return res.status(400).json({ error: 'Missing priceId or userId in request body.' });
    }

    // --- Verify Firebase ID token ---
    const authorization = req.headers.authorization;
    if (!authorization || !authorization.startsWith('Bearer ')) {
        console.error("Missing or malformed Authorization header.");
        return res.status(401).json({ error: 'Unauthorized: Missing or malformed token.' });
    }
    const idToken = authorization.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        if (decodedToken.uid !== userId) {
            console.error(`Token UID (${decodedToken.uid}) does not match request UID (${userId}).`);
            return res.status(403).json({ error: 'Forbidden: Token UID does not match request UID.' });
        }
        console.log(`User ${userId} authenticated successfully.`);

        // --- Create Stripe Checkout Session ---
        // VERCEL_URL is automatically set by Vercel in production deployments.
        // For local development, this might be undefined. You might need a fallback for local testing if you run this locally.
        const appUrl = process.env.VERCEL_ENV === 'production'
            ? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000') // Fallback for safety
            : 'http://localhost:3000'; // Or your local dev port from VS Code Live Server if it's consistent

        console.log(`Using appUrl for redirect: ${appUrl}`);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'payment',
            success_url: `${appUrl}/?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?payment_canceled=true`,
            client_reference_id: userId, // Pass Firebase UID to identify user in webhook
            customer_email: decodedToken.email, // Optional: prefill email on Stripe page
        });

        console.log("Stripe session created:", session.id);
        res.status(200).json({ sessionId: session.id, url: session.url });

    } catch (error) {
        console.error('Error in create-checkout-session handler:', error);
        if (error.type === 'StripeCardError') {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
            return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
        }
        res.status(500).json({ error: error.message || 'Failed to create checkout session.' });
    }
}