import { Router, Request, Response } from "express";
import axios, { AxiosError } from "axios";
import crypto from "crypto";
import { NgrokService } from "../services/ngrok.service.js";
import { CacheService } from "../services/cache.service.js";
import { getCardHTML } from "../utils.js";

const router = Router();

interface TwitterCacheData {
  verifier: string;
  successUri?: string;
}

/**
 * Cache for PKCE code verifiers and success URIs
 * - Key: state parameter (prevents CSRF)
 * - Value: code verifier (proves client identity) and success URI
 * TTL: 10 minutes
 */

/**
 * Generates a PKCE code verifier
 * - Creates cryptographically secure random bytes
 * - Converts to URL-safe base64 string
 * - Ensures compliance with RFC 7636 requirements
 * @returns {string} A code verifier string between 43-128 characters
 */
function generateCodeVerifier() {
  const buffer = crypto.randomBytes(32);
  const verifier = buffer
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "") // Remove non-alphanumeric chars
    .substring(0, 128); // Truncate to max length
  return verifier;
}

/**
 * Creates a code challenge from verifier for PKCE
 * - Hashes verifier using SHA256
 * - Converts to URL-safe base64 string
 * - Implements S256 transform per OAuth 2.0 spec
 * @param {string} verifier - The code verifier to transform
 * @returns {string} URL-safe base64 encoded challenge
 */
function generateCodeChallenge(verifier: string) {
  const hash = crypto.createHash("sha256");
  hash.update(verifier);
  const rawDigest = hash.digest("base64");

  // Convert to URL-safe format
  return rawDigest
    .replace(/\+/g, "-") // Convert '+' to '-'
    .replace(/\//g, "_") // Convert '/' to '_'
    .replace(/=/g, ""); // Remove padding '='
}

/**
 * Initiates Twitter OAuth 2.0 PKCE flow
 * - Generates state for CSRF protection
 * - Creates PKCE verifier/challenge pair
 * - Constructs Twitter authorization URL
 */
router.post("/init", async (req: Request, res: Response) => {
  try {
    const ngrokURL = await NgrokService.getInstance().getUrl();
    const { success_uri } = req.body;
    console.log("Success URI:", success_uri);
    // Generate CSRF protection state
    const state = crypto.randomBytes(16).toString("hex");

    // Generate and store PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    CacheService.getInstance().set<TwitterCacheData>(state, {
      verifier: codeVerifier,
      successUri: success_uri,
    });

    // Build Twitter OAuth URL with required parameters
    const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
    const params = {
      response_type: "code", // OAuth 2.0 auth code flow
      client_id: process.env.TWITTER_CLIENT_ID!, // Your app's client ID
      redirect_uri: `${ngrokURL}/auth/twitter/callback`, // Must match registered URL
      scope: "tweet.read users.read offline.access", // Requested permissions
      state: state, // CSRF token
      code_challenge: codeChallenge, // PKCE challenge
      code_challenge_method: "S256",
    };

    // Add params to URL
    Object.entries(params).forEach(([key, value]) => {
      authUrl.searchParams.append(key, value);
    });
    console.log(
      "[Twitter Init] Redirecting to Twitter authorization URL:",
      authUrl.toString()
    );
    res.json({ authUrl: authUrl.toString() });
  } catch (error) {
    console.error("[Twitter Auth] Error:", error);
    res.status(500).json({ error: "Auth initialization failed" });
  }
});

// Handle OAuth callback from Twitter
router.get("/callback", async (req: Request, res: Response) => {
  try {
    const ngrokURL = await NgrokService.getInstance().getUrl();
    const { code, state } = req.query;

    // Verify state matches and get stored verifier
    const stored = CacheService.getInstance().get<TwitterCacheData>(
      state as string
    );
    if (!stored) {
      throw new Error("Invalid state parameter");
    }
    const { verifier: codeVerifier, successUri } = stored;

    // Create basic auth header from client credentials
    const basicAuth = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
    ).toString("base64");

    // Exchange code for access token
    const params = new URLSearchParams({
      code: code as string,
      grant_type: "authorization_code",
      client_id: process.env.TWITTER_CLIENT_ID!,
      redirect_uri: `${ngrokURL}/auth/twitter/callback`,
      code_verifier: codeVerifier,
    });

    const tokenResponse = await axios.post(
      "https://api.twitter.com/2/oauth2/token",
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
      }
    );

    // Clean up stored verifier
    CacheService.getInstance().del(state as string);

    // Redirect to success_uri if provided, otherwise use default
    const redirectUrl = successUri || `/auth/twitter/success`;
    return res.redirect(
      302,
      `${redirectUrl}?token=${tokenResponse.data.access_token}`
    );
  } catch (error) {
    console.error("[Twitter Callback] Error:", error);
    if (error instanceof AxiosError) {
      console.error("[Twitter Callback] Response data:", error.response?.data);
      console.error(
        "[Twitter Callback] Response status:",
        error.response?.status
      );
      console.error(
        "[Twitter Callback] Response headers:",
        error.response?.headers
      );
      console.error("[Twitter Callback] Request URL:", error.config?.url);
      console.error("[Twitter Callback] Request params:", error.config?.params);
    }
    return res.redirect(302, `/auth/twitter/error`);
  }
});

router.get("/error", (_req: Request, _res: Response) => {
  _res.status(400).json({
    success: false,
    error: "Failed to fetch profile information",
  });
});

router.get("/success", async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token) {
      throw new Error("No token provided");
    }

    // Fetch user profile with token
    const profileResponse = await axios.get(
      "https://api.twitter.com/2/users/me",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          "user.fields":
            "description,profile_image_url,public_metrics,verified",
        },
      }
    );

    const profile = profileResponse.data;

    res.json({
      success: true,
      message: "Twitter authentication successful",
      token,
      profile,
    });
  } catch (error) {
    console.error("[Twitter Success] Error:", error);
    if (error instanceof AxiosError) {
      console.error("[Twitter Success] Response:", error.response?.data);
    }
    res.status(400).json({
      success: false,
      error: "Failed to fetch profile information",
    });
  }
});

router.get("/card/:slug/index.html", (req: Request, res: Response) => {
  //The slug is a string of base64<claimURL>:base64<botUsername>
  const slug = req.params.slug;
  const claimURLBase64 = slug.split(":")[0];
  const claimURL = Buffer.from(claimURLBase64, "base64").toString("ascii");
  const botUsernameBase64 = slug.split(":")[1];
  const botUsername = Buffer.from(botUsernameBase64, "base64").toString(
    "ascii"
  );
  console.log("Claim URL:", claimURL);
  console.log("Bot Username:", botUsername);
  res.setHeader("Content-Type", "text/html");
  res.send(getCardHTML(botUsername, claimURL));
});

export default router;
