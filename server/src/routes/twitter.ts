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
import { VoteService } from "../services/vote.service.js";
// import { fileURLToPath } from "url";

const router = Router();

interface TwitterCacheData {
  verifier: string;
  successUri?: string;
}

interface TwitterInitializationData {
  twitterId: string;
  username: string;
  tokenId: string;
  token: string;
  status:
    | "pending"
    | "pkp_generated"
    | "account_created"
    | "airdrop_sent"
    | "complete"
    | "failed";
  pkpAddress?: string;
  smartAccount?: string;
  txHash?: string;
  tokenBalance?: string;
  error?: string;
  timestamp: number;
}

// Interface for pending vote data
interface PendingVoteData {
  voteId: string;
  nomineeVotes: { nominee_id: number; vote_count: number }[];
  timestamp: number;
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
      const receipt = await Promise.race([
        tx.wait(),
        new Promise<null>((_, reject) =>
          setTimeout(
            () => reject(new Error("Transaction confirmation timeout")),
            60000
          )
        ),
      ]);

      if (receipt === null) {
        throw new Error("Transaction confirmation timed out");
      }

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

// Record vote endpoint
router.post(
  "/record-vote",
  async (req: Request, res: Response): Promise<void> => {
    try {
      console.log("[Vote Record] Received vote submission request");
      console.log(
        "[Vote Record] Request body:",
        JSON.stringify(req.body, null, 2)
      );

      const {
        username,
        smartAccount,
        tokenId,
        voteCount,
        nomineeVotes,
        accessToken,
        initializationInProgress,
      } = req.body;

      // Validate required fields - smartAccount can be 'pending' if initialization is still in progress
      if (
        !username ||
        !smartAccount ||
        !tokenId ||
        !voteCount ||
        !nomineeVotes
      ) {
        console.error("[Vote Record] Missing required fields:", {
          username: !!username,
          smartAccount: !!smartAccount,
          tokenId: !!tokenId,
          voteCount: !!voteCount,
          nomineeVotes: !!nomineeVotes,
        });

        res.status(400).json({
          success: false,
          error: "Missing required fields",
        });
        return;
      }

      // Log special case where initialization is still in progress
      if (initializationInProgress || smartAccount === "pending") {
        console.log(
          "[Vote Record] Initialization still in progress. Votes will be recorded in database only initially."
        );
      }

      // Check if accessToken is provided for on-chain submission
      if (!accessToken) {
        console.warn(
          "[Vote Record] No access token provided - will skip on-chain submission"
        );
      } else {
        console.log(
          "[Vote Record] Access token provided for on-chain submission"
        );
      }

      // Generate invite code for immediate response
      const inviteCode = await generateUniqueInviteCode();
      console.log("[Vote Record] Generated invite code:", inviteCode);

      // Create cache key for tracking this vote
      const cacheKey = `vote:${inviteCode}`;
      console.log("[Vote Record] Cache key:", cacheKey);

      // Store the code with the username in cache immediately
      const cacheService = CacheService.getInstance();
      cacheService.set(cacheKey, {
        username,
        smartAccount,
        tokenId,
        createdAt: Date.now(),
        used: true,
        initializationInProgress:
          initializationInProgress || smartAccount === "pending",
      });
      console.log("[Vote Record] Vote data stored in cache");

      // Send immediate response with the invite code
      console.log(
        "[Vote Record] Sending 202 Accepted response with invite code"
      );
      res.status(202).json({
        success: true,
        data: {
          inviteCode,
          message: "Vote submission accepted and processing",
        },
      });

      // Process the vote submission asynchronously
      (async () => {
        try {
          console.log("[Vote Processing] Starting background processing");

          // Use the invite code we already generated above
          console.log("[Vote Processing] Using invite code:", inviteCode);

          // Initialize services
          console.log("[Vote Processing] Initializing Supabase service");
          const supabaseService = await SupabaseService.getInstance();

          // Record the vote in Supabase even if smart account initialization is pending
          console.log(
            "[Vote Processing] Recording vote in database with data:",
            {
              username,
              smartAccount,
              tokenId,
              voteCount,
              nomineeVotesCount: nomineeVotes.length,
              initializationInProgress:
                initializationInProgress || smartAccount === "pending",
            }
          );

          const voteRecord = await supabaseService.recordVote(
            username,
            smartAccount,
            tokenId,
            voteCount,
            inviteCode,
            nomineeVotes
          );

          console.log(
            "[Vote Processing] Vote recorded in database with ID:",
            voteRecord.id
          );

          // If accessToken is provided and initialization is complete, submit the vote on-chain
          if (
            accessToken &&
            smartAccount !== "pending" &&
            !initializationInProgress
          ) {
            console.log("[Vote Processing] Preparing on-chain vote submission");
            try {
              console.log("[Vote Processing] Initializing VoteService");
              const voteService = VoteService.getInstance();

              console.log(
                "[Vote Processing] Calling submitVoteOnChain with parameters:",
                {
                  nomineeVotesCount: nomineeVotes.length,
                  smartAccount,
                  accessTokenPresent: !!accessToken,
                }
              );

              const result = await voteService.submitVoteOnChain(
                nomineeVotes,
                smartAccount,
                accessToken
              );

              console.log(
                "[Vote Processing] On-chain submission result:",
                result
              );

              if (result.success && result.txHash) {
                console.log(
                  "[Vote Processing] Vote submitted on-chain successfully with transaction hash:",
                  result.txHash
                );

                // Update the vote record with the transaction hash
                console.log(
                  "[Vote Processing] Updating vote record with transaction hash"
                );
                // await supabaseService.updateVoteTransaction(
                //   voteRecord.id,
                //   result.txHash
                // );
                console.log(
                  "[Vote Processing] Vote record updated with transaction hash"
                );
              } else {
                console.error(
                  "[Vote Processing] Failed to submit vote on-chain:",
                  result.error
                );

                // Log the vote record ID for manual updating if needed
                console.error(
                  "[Vote Processing] Vote record ID for manual update:",
                  voteRecord.id
                );
              }
            } catch (onChainError) {
              console.error(
                "[Vote Processing] Error during on-chain submission:",
                onChainError
              );

              if (onChainError instanceof Error) {
                console.error(
                  "[Vote Processing] Error name:",
                  onChainError.name
                );
                console.error(
                  "[Vote Processing] Error message:",
                  onChainError.message
                );
              }
            }
          } else {
            console.log(
              "[Vote Processing] Skipping on-chain submission because:",
              !accessToken
                ? "No access token provided"
                : "Smart account initialization is still in progress"
            );

            // Store the vote data for later processing when initialization completes
            if (initializationInProgress || smartAccount === "pending") {
              console.log(
                "[Vote Processing] Storing vote for later on-chain processing"
              );
              cacheService.set(`pending_vote:${username}:${tokenId}`, {
                voteId: voteRecord.id,
                nomineeVotes,
                timestamp: Date.now(),
              });
            }
          }
        } catch (processingError) {
          console.error(
            "[Vote Processing] Error during background processing:",
            processingError
          );
        }
      })();
    } catch (error) {
      console.error("[Vote Record] Error:", error);
      // Don't send a response here, as we already sent one above
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

// Initialize the backend processes in a non-blocking way
const handleInitialize = async (req: Request, res: Response) => {
  try {
    const { twitterId, username, tokenId, token } = req.body;

    if (!twitterId || !username || !tokenId || !token) {
      res.status(400).json({ error: "Missing required parameters" });
      return;
    }

    console.log(
      `[Initialize] Starting initialization for Twitter user: ${username} (${twitterId})`
    );

    // Check if we already have initialization data in the cache
    const cacheKey = `twitter_init:${twitterId}`;
    const existingData =
      CacheService.getInstance().get<TwitterInitializationData>(cacheKey);

    if (existingData && existingData.status === "complete") {
      console.log(
        `[Initialize] Found completed initialization for user ${username}`
      );
      res.status(200).json({
        message: "Initialization already complete",
        smartAccount: existingData.smartAccount,
        txHash: existingData.txHash,
        tokenBalance: existingData.tokenBalance,
      });
      return;
    }

    // Initialize the data in the cache with pending status
    const initData: TwitterInitializationData = {
      twitterId,
      username,
      tokenId,
      token,
      status: "pending",
      timestamp: Date.now(),
    };

    // Set with a longer TTL (1 hour) since initialization might take time
    CacheService.getInstance().set(cacheKey, initData);

    // Start the initialization process in the background
    processInitialization(initData).catch((err) => {
      console.error(
        `[Initialize] Background process error for ${username}:`,
        err
      );
      // Update cache with error information
      const failedData =
        CacheService.getInstance().get<TwitterInitializationData>(cacheKey);
      if (failedData) {
        failedData.status = "failed";
        failedData.error = err.message || "Unknown error during initialization";
        CacheService.getInstance().set(cacheKey, failedData);
      }
    });

    // Immediately return success to keep the frontend responsive
    res.status(202).json({
      message: "Initialization started",
      status: "pending",
    });
  } catch (error) {
    console.error("[Initialize] Error:", error);
    res.status(500).json({ error: "Failed to start initialization process" });
  }
};

// Check initialization status handler
const handleInitializationStatus = async (req: Request, res: Response) => {
  try {
    const { twitterId } = req.query;

    if (!twitterId) {
      res.status(400).json({ error: "Missing twitterId parameter" });
      return;
    }

    const cacheKey = `twitter_init:${twitterId}`;
    const data =
      CacheService.getInstance().get<TwitterInitializationData>(cacheKey);

    if (!data) {
      res.status(404).json({ error: "Initialization data not found" });
      return;
    }

    // Return current status
    res.status(200).json({
      status: data.status,
      complete: data.status === "complete",
      smartAccount: data.smartAccount,
      txHash: data.txHash,
      tokenBalance: data.tokenBalance,
      error: data.error,
    });
  } catch (error) {
    console.error("[Initialization Status] Error:", error);
    res.status(500).json({ error: "Failed to retrieve initialization status" });
  }
};

// Register the routes
router.post("/initialize", handleInitialize);
router.get("/initialization-status", handleInitializationStatus);

// Background process to handle initialization
async function processInitialization(
  data: TwitterInitializationData
): Promise<void> {
  const cacheKey = `twitter_init:${data.twitterId}`;
  const cacheService = CacheService.getInstance();

  try {
    console.log(
      `[ProcessInit] Starting background initialization for ${data.username}`
    );

    // Step 1: Generate PKP
    console.log(`[ProcessInit] Generating PKP for ${data.username}`);
    data.status = "pkp_generated";
    cacheService.set(cacheKey, data);

    const v2ApiUrl = getCollablandApiUrl().replace("v1", "v2");
    const client = axios.create({
      baseURL: process.env.COLLABLAND_API_URL || "https://api.collab.land",
      headers: {
        "X-API-KEY": process.env.COLLABLAND_API_KEY || "",
        "Content-Type": "application/json",
      },
      timeout: 30 * 1000, // 30 seconds timeout
    });

    // Add retry logic for PKP generation
    let pkpAddress: string | undefined;
    let pkpRetryCount = 0;
    const pkpMaxRetries = 5;

    while (!pkpAddress && pkpRetryCount < pkpMaxRetries) {
      try {
        console.log(
          `[ProcessInit] Attempting to generate PKP (attempt ${pkpRetryCount + 1}/${pkpMaxRetries})`
        );

        // Submit the user operation to execute the nomination
        const pkpResponse = await client.get(
          `${v2ApiUrl}/platform/accounts?platform=twitter`,
          {
            headers: {
              "X-ACCESS-TOKEN": data.token || "",
              "X-API-KEY": process.env.COLLABLAND_API_KEY || "",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          }
        );

        if (pkpResponse.data && pkpResponse.data.pkpAddress) {
          pkpAddress = pkpResponse.data.pkpAddress;
          console.log(
            `[ProcessInit] Successfully generated PKP address: ${pkpAddress}`
          );
          break;
        } else {
          console.warn(`[ProcessInit] PKP response missing pkpAddress`);
          pkpRetryCount++;
          if (pkpRetryCount < pkpMaxRetries) {
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s
            const backoffTime = Math.pow(2, pkpRetryCount) * 1000;
            console.log(`[ProcessInit] Retrying in ${backoffTime}ms...`);
            await new Promise((resolve) => setTimeout(resolve, backoffTime));
          }
        }
      } catch (error) {
        pkpRetryCount++;
        console.error(
          `[ProcessInit] Error generating PKP (attempt ${pkpRetryCount}/${pkpMaxRetries}):`,
          error
        );

        if (pkpRetryCount < pkpMaxRetries) {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          const backoffTime = Math.pow(2, pkpRetryCount) * 1000;
          console.log(`[ProcessInit] Retrying in ${backoffTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffTime));
        }
      }
    }

    if (!pkpAddress) {
      throw new Error(
        `Failed to generate PKP - no address returned after ${pkpMaxRetries} attempts`
      );
    }

    data.pkpAddress = pkpAddress;
    console.log(`[ProcessInit] Generated PKP address: ${data.pkpAddress}`);

    // Step 2: Get Smart Account
    console.log(`[ProcessInit] Creating smart account for ${data.username}`);
    data.status = "account_created";
    cacheService.set(cacheKey, data);

    // Add retry logic for account address calculation
    let smartAccount: string | undefined;
    let accountRetryCount = 0;
    const accountMaxRetries = 5;

    while (!smartAccount && accountRetryCount < accountMaxRetries) {
      try {
        // Use the proper method to get account address
        // Call the API directly instead of using the service
        console.log(
          `[ProcessInit] Attempting to calculate account address (attempt ${accountRetryCount + 1}/${accountMaxRetries})`
        );

        const accountResponse = await axios.post<IAccountInfo>(
          `${v2ApiUrl}/evm/calculateAccountAddress`,
          {
            platform: "twitter",
            userId: data.twitterId,
          },
          {
            headers: {
              "X-API-KEY": process.env.COLLABLAND_API_KEY!,
            },
            // Add timeout to prevent hanging
            timeout: 10000, // 10 seconds
          }
        );

        // We need base smart account addresses
        smartAccount = accountResponse.data.evm.find(
          (account) => account.chainId === 8453
        )?.address;

        if (smartAccount) {
          console.log(
            `[ProcessInit] Successfully calculated account address: ${smartAccount}`
          );
          break;
        } else {
          console.warn(
            `[ProcessInit] No account address found for chainId 8453`
          );
          accountRetryCount++;
          if (accountRetryCount < accountMaxRetries) {
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s
            const backoffTime = Math.pow(2, accountRetryCount) * 1000;
            console.log(`[ProcessInit] Retrying in ${backoffTime}ms...`);
            await new Promise((resolve) => setTimeout(resolve, backoffTime));
          }
        }
      } catch (error) {
        accountRetryCount++;
        console.error(
          `[ProcessInit] Error calculating account address (attempt ${accountRetryCount}/${accountMaxRetries}):`,
          error
        );

        if (accountRetryCount < accountMaxRetries) {
          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          const backoffTime = Math.pow(2, accountRetryCount) * 1000;
          console.log(`[ProcessInit] Retrying in ${backoffTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffTime));
        }
      }
    }

    if (!smartAccount) {
      throw new Error(
        `Failed to create smart account after ${accountMaxRetries} attempts`
      );
    }

    data.smartAccount = smartAccount;
    console.log(`[ProcessInit] Created smart account: ${data.smartAccount}`);

    // Step 3: Send airdrop
    console.log(`[ProcessInit] Sending airdrop to ${data.smartAccount}`);
    data.status = "airdrop_sent";
    cacheService.set(cacheKey, data);

    // Get the private key from environment variable
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("Airdrop private key not configured");
    }

    // Connect to Base Sepolia
    const provider = new ethers.JsonRpcProvider(
      process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"
    );
    const wallet = new ethers.Wallet(privateKey, provider);

    // Create contract instance for the vote token
    const voteTokenAddress = "0xb6a7325A1841f4097260599d76AaC8217e8C4762";
    const tokenAbi = [
      "function transfer(address to, uint256 amount) returns (bool)",
      "function balanceOf(address account) view returns (uint256)",
    ];
    const tokenContract = new ethers.Contract(
      voteTokenAddress,
      tokenAbi,
      wallet
    );

    // Amount to send (10 tokens with 18 decimals)
    const amount = ethers.parseUnits("10", 18);

    // Add retry logic for token transfer
    let txHash: string | undefined;
    let txRetryCount = 0;
    const txMaxRetries = 5;

    while (!txHash && txRetryCount < txMaxRetries) {
      try {
        console.log(
          `[ProcessInit] Attempting to send tokens (attempt ${txRetryCount + 1}/${txMaxRetries})`
        );

        // Send the transaction
        const tx = await tokenContract.transfer(data.smartAccount, amount);
        console.log(`[ProcessInit] Transaction sent: ${tx.hash}`);

        // Wait for transaction to be mined with timeout
        const receipt = await Promise.race([
          tx.wait(),
          new Promise<null>((_, reject) =>
            setTimeout(
              () => reject(new Error("Transaction confirmation timeout")),
              60000
            )
          ),
        ]);

        if (receipt === null) {
          throw new Error("Transaction confirmation timed out");
        }

        console.log(`[ProcessInit] Transaction confirmed: ${receipt.hash}`);
        txHash = receipt.hash;
        break;
      } catch (error) {
        txRetryCount++;
        console.error(
          `[ProcessInit] Error sending tokens (attempt ${txRetryCount}/${txMaxRetries}):`,
          error
        );

        if (txRetryCount < txMaxRetries) {
          // Exponential backoff: 2s, 4s, 8s, 16s, 32s
          const backoffTime = Math.pow(2, txRetryCount + 1) * 1000;
          console.log(`[ProcessInit] Retrying in ${backoffTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffTime));
        }
      }
    }

    if (!txHash) {
      throw new Error(`Failed to send tokens after ${txMaxRetries} attempts`);
    }

    data.txHash = txHash;

    // Small delay to ensure the blockchain has updated
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Add retry logic for balance check
    let tokenBalance: string | undefined;
    let balanceRetryCount = 0;
    const balanceMaxRetries = 3;

    while (balanceRetryCount < balanceMaxRetries) {
      try {
        console.log(
          `[ProcessInit] Checking token balance (attempt ${balanceRetryCount + 1}/${balanceMaxRetries})`
        );
        const balance = await tokenContract.balanceOf(data.smartAccount);
        tokenBalance = ethers.formatUnits(balance, 18);
        console.log(`[ProcessInit] Token balance: ${tokenBalance}`);
        break;
      } catch (error) {
        balanceRetryCount++;
        console.error(
          `[ProcessInit] Error checking balance (attempt ${balanceRetryCount}/${balanceMaxRetries}):`,
          error
        );

        if (balanceRetryCount < balanceMaxRetries) {
          // Linear backoff: 2s, 2s, 2s
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    data.tokenBalance = tokenBalance || "0";

    // Step 4: Mark as complete
    data.status = "complete";
    data.timestamp = Date.now();
    cacheService.set(cacheKey, data);

    console.log(`[ProcessInit] Initialization complete for ${data.username}`);

    // Update any votes that were submitted with a 'pending' smart account
    if (data.smartAccount) {
      try {
        console.log(
          `[ProcessInit] Updating votes with pending smart accounts for ${data.username}`
        );
        const supabaseService = await SupabaseService.getInstance();
        await supabaseService.updateVoteSmartAccount(
          data.username,
          data.tokenId,
          data.smartAccount
        );
      } catch (error) {
        console.error(`[ProcessInit] Error updating pending votes:`, error);
      }
    }

    // Check for and process any pending votes
    if (data.smartAccount && data.token) {
      console.log(
        `[ProcessInit] Checking for pending votes for ${data.username}`
      );
      await processPendingVotes(
        data.username,
        data.tokenId,
        data.smartAccount,
        data.token
      );
    }
  } catch (error) {
    console.error(`[ProcessInit] Error for user ${data.username}:`, error);

    // Update cache with error status
    data.status = "failed";
    data.error = error instanceof Error ? error.message : "Unknown error";
    data.timestamp = Date.now();
    cacheService.set(cacheKey, data);
  }
}

// Function to check for and process pending votes after initialization completes
async function processPendingVotes(
  username: string,
  tokenId: string,
  smartAccount: string,
  accessToken: string
) {
  try {
    console.log(
      `[PendingVotes] Checking for pending votes for ${username} with token ${tokenId}`
    );

    const cacheService = CacheService.getInstance();
    const pendingVoteKey = `pending_vote:${username}:${tokenId}`;

    // Check if there are any pending votes
    const pendingVoteData = cacheService.get<PendingVoteData>(pendingVoteKey);

    if (!pendingVoteData) {
      console.log(`[PendingVotes] No pending votes found for ${username}`);
      return;
    }

    console.log(`[PendingVotes] Found pending vote data:`, pendingVoteData);

    // Get the vote ID and nominee votes
    const { voteId, nomineeVotes } = pendingVoteData;

    if (!voteId || !nomineeVotes) {
      console.error(`[PendingVotes] Invalid pending vote data for ${username}`);
      return;
    }

    console.log(`[PendingVotes] Processing pending vote with ID ${voteId}`);

    // Submit the vote on-chain
    try {
      console.log(`[PendingVotes] Initializing VoteService`);
      const voteService = VoteService.getInstance();

      console.log(`[PendingVotes] Calling submitVoteOnChain with parameters:`, {
        nomineeVotesCount: nomineeVotes.length,
        smartAccount,
        accessTokenPresent: !!accessToken,
      });

      const result = await voteService.submitVoteOnChain(
        nomineeVotes,
        smartAccount,
        accessToken
      );

      console.log(`[PendingVotes] On-chain submission result:`, result);

      if (result.success && result.txHash) {
        console.log(
          `[PendingVotes] Vote submitted on-chain successfully with transaction hash:`,
          result.txHash
        );

        // Update the vote record with the transaction hash
        console.log(
          `[PendingVotes] Updating vote record with transaction hash`
        );
        const supabaseService = await SupabaseService.getInstance();

        // Update both transaction hash and smart account since the original vote likely had 'pending'
        await supabaseService.updateVoteTransaction(
          voteId,
          result.txHash,
          smartAccount
        );

        console.log(
          `[PendingVotes] Vote record updated with transaction hash and smart account`
        );

        // Remove the pending vote data from cache
        cacheService.del(pendingVoteKey);
        console.log(`[PendingVotes] Removed pending vote data from cache`);
      } else {
        console.error(
          `[PendingVotes] Failed to submit vote on-chain:`,
          result.error
        );
      }
    } catch (error) {
      console.error(`[PendingVotes] Error during on-chain submission:`, error);
    }
  } catch (error) {
    console.error(`[PendingVotes] Error processing pending votes:`, error);
  }
}

export default router;
