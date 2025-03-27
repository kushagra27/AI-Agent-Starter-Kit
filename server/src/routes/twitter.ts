import { Router, Request, Response } from "express";
import axios, { AxiosError } from "axios";
import crypto from "crypto";
import { NgrokService } from "../services/ngrok.service.js";
import { CacheService } from "../services/cache.service.js";
import { getCardHTML, getCollablandApiUrl } from "../utils.js";
import { IAccountInfo } from "../types.js";
import { TwitterService } from "../services/twitter.service.js";
import { SupabaseService } from "../services/supabase.service.js";
import { ethers } from "ethers";
import path from "path";
import fs from "fs";

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

// Simplified invite code generation without cache
const generateUniqueInviteCode = async (): Promise<string> => {
  // Generate a random 6-character code
  console.log("Generating unique invite code...");
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  return code;
};

/**
 * Initiates Twitter OAuth 2.0 PKCE flow
 * - Generates state for CSRF protection
 * - Creates PKCE verifier/challenge pair
 * - Constructs Twitter authorization URL
 */
router.post("/init", async (req: Request, res: Response) => {
  console.log("init");
  try {
    const ngrokURL = await NgrokService.getInstance().getUrl();
    console.log("NGROK URL:", ngrokURL);
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
      scope: "tweet.read users.read offline.access tweet.write", // Requested permissions
      state: state, // CSRF token
      code_challenge: codeChallenge, // PKCE challenge
      code_challenge_method: "S256",
    };

    console.log("Params:", params);

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
  let claimURL = Buffer.from(claimURLBase64, "base64").toString("ascii");
  console.log("Claim URL:", claimURL);
  // replace the domain name of the claimURL with the current NEXT_PUBLIC_HOSTNAME
  const _claimURL = new URL(claimURL);
  _claimURL.hostname = process.env.NEXT_PUBLIC_HOSTNAME!;
  claimURL = _claimURL.toString();
  console.log("Updated Claim URL:", claimURL);
  const botUsernameBase64 = slug.split(":")[1];
  const botUsername = Buffer.from(botUsernameBase64, "base64").toString(
    "ascii"
  );
  console.log("Bot Username:", botUsername);
  res.setHeader("Content-Type", "text/html");
  res.send(getCardHTML(botUsername, claimURL));
});

router.get("/getAccountAddress", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    console.log("Getting account address for Twitter User ID:", userId);
    if (!userId) {
      throw new Error("No user id provided");
    }
    const v2ApiUrl = getCollablandApiUrl().replace("v1", "v2");
    // This AccountKit API returns counterfactually calculated smart account addresses for a GitHub/Twitter user
    const { data } = await axios.post<IAccountInfo>(
      `${v2ApiUrl}/evm/calculateAccountAddress`,
      {
        platform: "twitter",
        userId: userId,
      },
      {
        headers: {
          "X-API-KEY": process.env.COLLABLAND_API_KEY!,
        },
      }
    );
    console.log(
      "[Twitter Success] Account address for Twitter User ID:",
      userId,
      data
    );
    // We need base smart account addresses for Wow.XYZ
    const accountAddress = data.evm.find(
      (account) => account.chainId === 8453
    )?.address;
    res.json({
      success: true,
      account: accountAddress,
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

router.get(
  "/sendAirdrop/:tokenId/:recipient",
  async (req: Request, res: Response) => {
    // Set timeout to 10 minutes
    req.setTimeout(10 * 60 * 1000);
    res.setTimeout(10 * 60 * 1000);
    try {
      const { tokenId, recipient } = req.params;
      console.log(
        `[Twitter Airdrop] Sending airdrop for token ${tokenId} to ${recipient}`
      );

      // Use private key from environment variables
      if (!process.env.PRIVATE_KEY) {
        throw new Error(
          "WALLET_PRIVATE_KEY is not configured in environment variables"
        );
      }

      // Connect to Base Sepolia network
      const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

      // Token contract address for the voting token
      const tokenContractAddress = "0xb6a7325A1841f4097260599d76AaC8217e8C4762";

      // ABI for ERC20 token (we only need the transfer function)
      const tokenAbi = [
        "function transfer(address to, uint256 value) returns (bool)",
        "function balanceOf(address account) view returns (uint256)",
        "function decimals() view returns (uint8)",
      ];

      // Connect to the token contract
      const tokenContract = new ethers.Contract(
        tokenContractAddress,
        tokenAbi,
        wallet
      );

      // Amount to send - 100 tokens
      const decimals = await tokenContract.decimals();
      const amount = ethers.parseUnits("10", decimals);

      console.log(`[Twitter Airdrop] Sending ${amount} tokens to ${recipient}`);

      // Check balance before sending
      const balance = await tokenContract.balanceOf(wallet.address);
      console.log(`[Twitter Airdrop] Contract balance: ${balance}`);

      if (balance < amount) {
        throw new Error(
          `Insufficient token balance. Required: ${amount}, Available: ${balance}`
        );
      }

      // Send the tokens
      const tx = await tokenContract.transfer(recipient, amount);
      console.log(`[Twitter Airdrop] Transaction submitted: ${tx.hash}`);

      // Wait for transaction to be confirmed
      const receipt = await tx.wait();
      console.log(`[Twitter Airdrop] Transaction confirmed: ${receipt.hash}`);

      // Cache the transaction hash?
      const txHash = receipt.hash;
      console.log("[Twitter Airdrop] Airdrop sent with tx hash:", txHash);

      res.json({
        success: true,
        txHash: txHash,
      });
    } catch (error) {
      console.error("[Twitter Airdrop] Error:", error);
      if (error instanceof AxiosError) {
        console.error("[Twitter Airdrop] Response:", error.response?.data);
      }
      res.status(400).json({
        success: false,
        error: "Failed to send airdrop",
      });
    }
  }
);

router.post("/tweetCard", async (req: Request, res: Response) => {
  try {
    const me = await TwitterService.getInstance().me;
    const { txHash: _txHash, tokenId } = req.body;
    const token = req.headers["x-auth-token"] as string;
    if (!token) {
      throw new Error("No token provided");
    }
    const claimURL = process.env.NEXT_PUBLIC_HOSTNAME! + `/claim/${tokenId}`;
    const slug =
      Buffer.from(claimURL).toString("base64url") +
      ":" +
      Buffer.from(me?.username ?? "").toString("base64url");
    const ngrokURL = await NgrokService.getInstance().getUrl();
    const claimURLWithNgrok =
      ngrokURL + `/auth/twitter/card/${slug}/index.html`;
    console.log("[Tweet Card] Claim URL:", claimURLWithNgrok);
    const message = `🎉 Just claimed my @wow tokens through @${me?.username} Claim yours now, get started below! 🚀\n\n${claimURLWithNgrok}`;
    console.log("[Tweet Card] Sending tweet:", message);
    const { data } = await axios.post(
      "https://api.twitter.com/2/tweets",
      {
        text: message,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    console.log("[Tweet Card] Tweet sent:", data);
    const tweetId = data.data.id;
    const txHash = _txHash;
    const replyMessage = `Transaction hash: https://basescan.org/tx/${txHash}`;
    console.log("[Tweet Card] Replying to tweet:", replyMessage);
    const { data: replyData } = await axios.post(
      "https://api.twitter.com/2/tweets",
      {
        text: replyMessage,
        reply: {
          in_reply_to_tweet_id: tweetId,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    console.log("[Tweet Card] Reply sent:", replyData);

    const tweetUrl = `https://twitter.com/i/web/status/${tweetId}`;
    console.log("[Twitter Success] Tweet sent successfully:", tweetUrl);

    res.json({
      success: true,
      tweetId,
      tweetUrl,
    });
  } catch (error) {
    console.error("[Tweet Card] Error:", error);
    if (error instanceof AxiosError) {
      console.error("[Tweet Card] Response:", error.response?.data);
    }
    res.status(400).json({
      success: false,
      error: "Failed to send tweet",
    });
  }
});

// Add route to record vote and store in Supabase
router.post(
  "/record-vote",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { username, smartAccount, tokenId, voteCount, nomineeVotes } =
        req.body;

      if (
        !username ||
        !smartAccount ||
        !tokenId ||
        !voteCount ||
        !nomineeVotes
      ) {
        res.status(400).json({
          success: false,
          error: "Missing required fields",
        });
        return;
      }

      // Generate invite code
      const inviteCode = await generateUniqueInviteCode();
      console.log("[Invite Code] Generated code:", inviteCode);

      // Record the vote in Supabase
      const supabase = await SupabaseService.getInstance();
      const voteRecord = await supabase.recordVote(
        username,
        smartAccount,
        tokenId,
        voteCount,
        inviteCode,
        nomineeVotes
      );

      // Store the code with the username in cache
      CacheService.getInstance().set(inviteCode, {
        username,
        smartAccount,
        tokenId,
        createdAt: Date.now(),
        used: true,
      });

      res.json({
        success: true,
        data: {
          ...voteRecord,
          inviteCode,
        },
      });
    } catch (error) {
      console.error("[Vote Record] Error recording vote:", error);
      res.status(500).json({
        success: false,
        error: "Failed to record vote",
      });
    }
  }
);

// Add route to verify invite code
router.get(
  "/verify-invite-code/:code",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params;
      const supabase = await SupabaseService.getInstance();
      const voteRecord = await supabase.getVoteByInviteCode(code);

      if (!voteRecord) {
        res.status(404).json({
          success: false,
          error: "Invalid invite code",
        });
        return;
      }

      res.json({
        success: true,
        data: voteRecord,
      });
    } catch (error) {
      console.error("[Invite Code] Error verifying code:", error);
      res.status(500).json({
        success: false,
        error: "Failed to verify invite code",
      });
    }
  }
);

// Define the assets directory path
const ASSETS_DIR = path.join(process.cwd(), "assets");

// Ensure assets directory exists
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Route to retrieve assets
router.get("/asset/:filename", async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(ASSETS_DIR, filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("Asset not found");
    }

    // Set appropriate headers
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    // Handle errors in the stream
    fileStream.on("error", (error) => {
      console.error("[Asset Retrieval] Stream Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to stream asset",
      });
    });
  } catch (error) {
    console.error("[Asset Retrieval] Error:", error);
    res.status(404).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to retrieve asset",
    });
  }
});

export default router;
