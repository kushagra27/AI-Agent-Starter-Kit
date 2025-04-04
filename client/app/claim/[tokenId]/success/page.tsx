"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactConfetti from "react-confetti";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  fetchNominees,
  getVotingStatus,
  getUserTokenBalance,
} from "@/app/utils/contractUtils";

interface TwitterProfile {
  data: {
    id: string;
    name: string;
    username: string;
    description?: string;
    profile_image_url?: string;
    public_metrics?: {
      followers_count: number;
      following_count: number;
      tweet_count: number;
    };
    verified?: boolean;
  };
}

interface Nominee {
  id: number;
  name: string;
  twitterHandle: string;
  voteCount: number;
  votePercentage: number;
  nominatedByTwitter?: string;
  imageUrl?: string;
}

interface VotingStatus {
  isVotingOpen: boolean;
  endTime: number | null;
  totalVotes: number;
}

// New interfaces for agent battle
interface AgentPair {
  leftAgent: Nominee;
  rightAgent: Nominee;
  selectedId: number | null;
}

export default function SuccessPage() {
  const { tokenId } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [profile, setProfile] = useState<TwitterProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState<string>("Authenticating...");
  const [smartAccount, setSmartAccount] = useState<string | null>(null);
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [isLoadingNominees, setIsLoadingNominees] = useState(true);
  const [votingError, setVotingError] = useState<string | null>(null);
  const [_votingStatus, setVotingStatus] = useState<VotingStatus>({
    isVotingOpen: false,
    endTime: null,
    totalVotes: 0,
  });
  const [nomineeVoteCounts, setNomineeVoteCounts] = useState<
    Record<number, number>
  >({});
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [_tokenBalance, setTokenBalance] = useState<string>("0");
  const [_isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [showInviteCode, setShowInviteCode] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [_voteSubmitted, setVoteSubmitted] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  });
  const [txHash, setTxHash] = useState<string | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);

  // New state for agent battles
  const [agentPairs, setAgentPairs] = useState<AgentPair[]>([]);
  const [currentPairIndex, setCurrentPairIndex] = useState(0);
  const [_allSelectionsComplete, setAllSelectionsComplete] = useState(false);

  // Create agent pairs from nominees
  useEffect(() => {
    if (nominees.length >= 2) {
      // Limit to 3 unique battles with different nominees
      const pairs: AgentPair[] = [];

      // Create a copy of nominees array to work with
      const availableNominees = [...nominees];

      // Shuffle the nominees to randomize the selection
      // availableNominees.sort(() => Math.random() - 0.5);

      // Create up to 3 pairs, ensuring no nominee appears twice
      // We'll pick nominees in order from the shuffled array
      const maxPairs = Math.min(4, Math.floor(availableNominees.length / 2));

      for (let i = 0; i < maxPairs; i++) {
        // Get the next two nominees from the shuffled array
        const leftAgent = availableNominees[i * 2];
        const rightAgent = availableNominees[i * 2 + 1];

        // Ensure both agents have valid image URLs
        [leftAgent, rightAgent].forEach((agent) => {
          if (!agent.imageUrl) {
            const map: Record<string, string> = {
              luna_virtuals: "luna.jpg",
              elizawakesup: "eliza.jpg",
              god: "god.jpg",
              s8n: "s8n.jpg",
              aixbt_agent: "aixbt.jpg",
              degenspartanai: "degenspartan.jpg",
              grok: "grok.jpg",
              AskPerplexity: "perplexity.jpg",
            };

            // Generate image URL with fallback
            const imageFilename =
              map[agent.twitterHandle] ||
              `${agent.name.charAt(0).toLowerCase()}.jpg`;
            agent.imageUrl = `https://closing-elf-internal.ngrok-free.app/auth/twitter/asset/${imageFilename}`;
            console.log(
              `Generated image URL for ${agent.name}:`,
              agent.imageUrl
            );
          }
        });

        pairs.push({
          leftAgent,
          rightAgent,
          selectedId: null,
        });
      }

      setAgentPairs(pairs);
    }
  }, [nominees]);

  // Handle agent selection in battle
  const handleAgentSelection = (nomineeId: number) => {
    if (currentPairIndex >= agentPairs.length) return;

    // Update the selection for current pair
    setAgentPairs((prev) => {
      const updated = [...prev];
      updated[currentPairIndex].selectedId = nomineeId;
      return updated;
    });

    // Increment vote count for the selected nominee
    setNomineeVoteCounts((prev) => ({
      ...prev,
      [nomineeId]: (prev[nomineeId] || 0) + 1,
    }));

    // Wait a moment to show the selection before moving to next pair
    setTimeout(() => {
      if (currentPairIndex < agentPairs.length - 1) {
        // Move to next pair
        setCurrentPairIndex((prevIndex) => prevIndex + 1);
      } else {
        // All selections complete - set state first, then submit votes
        setAllSelectionsComplete(true);

        // Add a delay to ensure state updates are complete before submission
        setTimeout(() => {
          handleSubmitVote();
        }, 500);
      }
    }, 800);
  };

  // Add effect to clear messages after 7 seconds
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    if (votingError) {
      timeoutId = setTimeout(() => {
        setVotingError(null);
      }, 7000);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [votingError]);

  // Function to trigger backend initialization in non-blocking way
  const triggerBackendInitialization = async (profileData: TwitterProfile) => {
    try {
      const token = sessionStorage.getItem("twitter_token");
      if (!token || !profileData?.data?.id || !tokenId) {
        console.error("Missing required data for backend initialization");
        return;
      }

      // Show loader with message about account preparation for 7 seconds
      setIsLoading(true);
      setLoadingStep("Getting your smart account ready...");

      console.log(
        "Triggering backend initialization for user:",
        profileData.data.username
      );

      // Make an API call to the backend to start the initialization process
      const response = await fetch("/api/auth/twitter/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          twitterId: profileData.data.id,
          username: profileData.data.username,
          tokenId,
          token,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.warn("Backend initialization started with issues:", error);
        // Still continue with the flow, just log the warning
      } else {
        const data = await response.json();
        console.log("Backend initialization started successfully:", data);
      }

      // Start polling for initialization status in the background
      startPollingInitializationStatus(profileData.data.id);

      // Show the account preparation message for a total of 7 seconds
      // with a sequence of different messages
      setTimeout(() => {
        setLoadingStep("Prepare to pick your champions...");
      }, 3000);

      setTimeout(() => {
        // After 7 seconds, continue with the UI flow regardless of backend status
        setIsLoading(false);
        setSetupComplete(true);
        setLoadingStep("");
      }, 7000);
    } catch (err) {
      console.error("Error triggering backend initialization:", err);
      // Even if there's an error, continue with the UI flow
      setTimeout(() => {
        setIsLoading(false);
        setSetupComplete(true);
        setLoadingStep("");
      }, 7000);
    }
  };

  // Integrated process: Fetch Twitter profile -> Then show the UI immediately while backend processes
  useEffect(() => {
    const initializeUserFlow = async () => {
      try {
        setIsLoading(true);
        setLoadingStep("Authenticating with Twitter...");

        // Step 1: Get Twitter profile - this remains on the frontend
        const profileData = await fetchTwitterProfile();
        if (!profileData) {
          throw new Error("Failed to fetch Twitter profile");
        }

        // Step 2: Immediately trigger backend initialization (non-blocking)
        triggerBackendInitialization(profileData);

        // Step 3: Load nominees and voting data in the background while showing loader
        loadNomineesAndVotingData().catch((err) => {
          console.error("Error loading nominees and voting data:", err);
        });

        // Note: We don't set isLoading=false here anymore because triggerBackendInitialization
        // will handle that after the 7-second loading period
      } catch (err) {
        console.error("Error in user flow:", err);
        setError(err instanceof Error ? err.message : "Something went wrong");
        setIsLoading(false);
      }
    };

    initializeUserFlow();
  }, [searchParams, tokenId]);

  // Function to poll for backend initialization status and update UI accordingly
  const startPollingInitializationStatus = (twitterId: string) => {
    let attempts = 0;
    const maxAttempts = 20; // Poll for up to 2 minutes (20 attempts × 6 seconds)

    const checkStatus = async () => {
      if (attempts >= maxAttempts) {
        console.log("Reached maximum polling attempts, stopping");
        return;
      }

      attempts++;

      try {
        const response = await fetch(
          `/api/auth/twitter/initialization-status?twitterId=${twitterId}`
        );
        if (!response.ok) {
          console.warn(
            `Initialization status check failed (attempt ${attempts})`
          );
          return setTimeout(checkStatus, 6000);
        }

        const data = await response.json();
        console.log("Initialization status:", data);

        // Update status message based on backend progress
        if (data.status === "pkp_generated") {
          setLoadingStep("Secure key created! Setting up your account...");
        } else if (data.status === "account_created") {
          setLoadingStep("Account ready! Sending test tokens...");
        } else if (data.status === "airdrop_sent") {
          setLoadingStep("Tokens sent! Finalizing setup...");
        }

        if (data.complete) {
          // Store the results
          if (data.smartAccount) {
            setSmartAccount(data.smartAccount);
            sessionStorage.setItem("smart_account", data.smartAccount);
          }

          if (data.txHash) {
            setTxHash(data.txHash);
            const cachedTxKey = `tx_hash_${data.smartAccount}_${tokenId}`;
            sessionStorage.setItem(cachedTxKey, data.txHash);
          }

          // Update token balance if provided
          if (data.tokenBalance) {
            setTokenBalance(data.tokenBalance);
          }

          console.log("Backend initialization completed");

          // Refresh nominations data since we now have updated information
          loadNomineesAndVotingData();

          return;
        }

        // Show error message if initialization failed
        if (data.status === "failed" && data.error) {
          console.error("Initialization failed:", data.error);
          // We don't want to block the UI completely, so just set a warning
          setVotingError(
            `Note: ${data.error} You can still vote, but on-chain actions might be limited.`
          );
          return;
        }

        // Continue polling if not complete
        setTimeout(checkStatus, 6000);
      } catch (err) {
        console.error("Error checking initialization status:", err);
        setTimeout(checkStatus, 6000);
      }
    };

    // Start polling after a short delay
    setTimeout(checkStatus, 2000);
  };

  const fetchTwitterProfile = async (): Promise<TwitterProfile | null> => {
    try {
      // First check if we already have a profile in session storage
      const storedProfile = sessionStorage.getItem("twitter_profile");
      const storedToken = sessionStorage.getItem("twitter_token");

      if (storedProfile && storedToken) {
        console.log("Using stored Twitter profile from session storage");
        const profile = JSON.parse(storedProfile);
        setProfile(profile);
        return profile;
      }

      // Otherwise proceed with fetching from API
      const token = searchParams.get("token");
      if (!token) {
        throw new Error("No token provided");
      }
      // Store token in session storage
      sessionStorage.setItem("twitter_token", token);

      const response = await fetch("/api/auth/twitter/success?token=" + token);

      if (!response.ok) {
        throw new Error("Failed to fetch profile");
      }

      const data = await response.json();
      setProfile(data.profile);
      sessionStorage.setItem("twitter_profile", JSON.stringify(data.profile));
      return data.profile;
    } catch (err) {
      console.error("Failed to fetch Twitter profile:", err);
      return null;
    }
  };

  const loadNomineesAndVotingData = async () => {
    try {
      setIsLoadingNominees(true);

      // Fetch nominees and voting status
      const fetchedNominees = await fetchNominees();
      const status = await getVotingStatus();

      // Try to get balance if we have a smart account
      if (smartAccount) {
        try {
          const balance = await getUserTokenBalance(smartAccount);
          setTokenBalance(balance);
        } catch (err) {
          console.warn("Could not get token balance:", err);
        }
      }

      fetchedNominees.map((n: Nominee) => {
        const map: Record<string, string> = {
          luna_virtuals: "luna.jpg",
          elizawakesup: "eliza.jpg",
          god: "god.jpg",
          s8n: "s8n.jpg",
          aixbt_agent: "aixbt.jpg",
          degenspartanai: "degenspartan.jpg",
          grok: "grok.jpg",
          AskPerplexity: "perplexity.jpg",
        };

        // Try the original image service first
        const imageFilename =
          map[n.twitterHandle] || `${n.name.charAt(0).toLowerCase()}.jpg`;
        const primaryImageUrl = `https://closing-elf-internal.ngrok-free.app/auth/twitter/asset/${imageFilename}`;

        // Create a reliable fallback using initial-based avatars from public service
        // This will be used if the onError handler triggers in the AgentCard component
        // const fallbackImageUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(n.name)}&background=random&size=200&color=fff&bold=true`;

        // Set the primary URL, fallback will be handled by onError in the component
        n.imageUrl = primaryImageUrl;

        // Log for debugging
        console.log(
          `Image URL for ${n.name} (@${n.twitterHandle}):`,
          n.imageUrl
        );
      });

      setNominees(fetchedNominees || []);
      setVotingStatus(status);

      return true;
    } catch (err) {
      console.error("Error fetching nominees and voting data:", err);
      return false;
    } finally {
      setIsLoadingNominees(false);
    }
  };

  const handleSubmitVote = async () => {
    try {
      // Check if we have the minimum required data for voting
      // Allow voting even if smartAccount is not ready yet
      if (!profile?.data.username) {
        console.error(
          "[Vote] Missing Twitter username:",
          profile?.data.username
        );
        return;
      }

      setIsSubmittingVote(true);
      setError(null);

      // Log the current state of agent pairs to debug
      console.log(
        "[Vote] Current agent pairs at submission:",
        JSON.stringify(agentPairs)
      );

      // Get all nominees with non-zero votes from agent pair selections
      // This ensures we capture the most recent selections
      const updatedVoteCounts = { ...nomineeVoteCounts };

      // Make sure we're getting the latest selections from agent pairs
      agentPairs.forEach((pair, index) => {
        if (pair.selectedId) {
          console.log(
            `[Vote] Including selection from pair ${index}: nominee ID ${pair.selectedId}`
          );
          updatedVoteCounts[pair.selectedId] =
            (updatedVoteCounts[pair.selectedId] || 0) + 1;
        } else {
          console.log(`[Vote] No selection for pair ${index}`);
        }
      });

      console.log("[Vote] Updated vote counts from pairs:", updatedVoteCounts);

      // Convert to nominee votes format
      const nomineeVotes = Object.entries(updatedVoteCounts)
        .filter(([_, count]) => count > 0)
        .map(([id, count]) => ({
          nominee_id: parseInt(id),
          vote_count: count,
        }));

      console.log("[Vote] Nominee votes to submit:", nomineeVotes);

      if (nomineeVotes.length === 0) {
        throw new Error("No votes to submit");
      }

      // Calculate total vote count
      const totalVoteCount = nomineeVotes.reduce(
        (sum, vote) => sum + vote.vote_count,
        0
      );

      // Get Twitter access token from session storage
      const accessToken = sessionStorage.getItem("twitter_token");
      console.log("[Vote] Access token available:", !!accessToken);

      if (!accessToken) {
        console.warn(
          "[Vote] Access token is missing - vote will be recorded but not submitted on-chain"
        );
      }

      // Use smart account if available, otherwise send a placeholder
      // The backend will handle the case where smart account is not yet ready
      const currentSmartAccount = smartAccount || "pending";

      const requestPayload = {
        username: profile.data.username,
        smartAccount: currentSmartAccount,
        tokenId,
        voteCount: totalVoteCount,
        nomineeVotes,
        accessToken, // Include access token for on-chain submission
        initializationInProgress: !smartAccount, // Flag to indicate if initialization is still in progress
      };

      console.log(
        "[Vote] Sending request payload:",
        JSON.stringify(requestPayload, null, 2)
      );

      // Send the vote data to the backend which will handle both on-chain and database submissions
      console.log(
        "[Vote] Submitting to endpoint:",
        "/api/auth/twitter/record-vote"
      );
      const response = await fetch("/api/auth/twitter/record-vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      console.log("[Vote] Response status:", response.status);

      const responseData = await response.json();
      console.log("[Vote] Response data:", responseData);

      if (!response.ok) {
        throw new Error(responseData.error || "Failed to submit vote");
      }

      if (responseData.success) {
        // Reset vote counts
        setNomineeVoteCounts({});

        // Show success message and invite code
        const successMessage = `Successfully submitted ${totalVoteCount} vote${totalVoteCount > 1 ? "s" : ""} for ${nomineeVotes.length} nominee${nomineeVotes.length > 1 ? "s" : ""}.`;
        setVotingError(successMessage);
        console.log("[Vote] Success:", successMessage);

        // Set invite code from response
        const inviteCode = responseData.data.inviteCode;
        console.log("[Vote] Received invite code:", inviteCode);

        setInviteCode(inviteCode);

        // Add a 3-second delay before showing the invite code
        setTimeout(() => {
          setShowInviteCode(true);
          setShowConfetti(true);

          // Stop confetti after 5 seconds
          setTimeout(() => setShowConfetti(false), 5000);
        }, 3000);

        setVoteSubmitted(true);

        // Force setup to be complete regardless of initialization status
        setSetupComplete(true);
      } else {
        throw new Error(responseData.error || "Failed to submit vote");
      }
    } catch (error) {
      console.error("[Vote] Error details:", error);

      // More detailed error information
      if (error instanceof Error) {
        console.error("[Vote] Error name:", error.name);
        console.error("[Vote] Error message:", error.message);
        console.error("[Vote] Error stack:", error.stack);
      }

      // Try to determine if it's a network issue or server issue
      if (error instanceof TypeError && error.message.includes("fetch")) {
        console.error("[Vote] Network error - check your internet connection");
        setVotingError(
          "Network error - please check your internet connection and try again"
        );
      } else {
        setVotingError(
          error instanceof Error
            ? error.message
            : "An unknown error occurred while submitting your vote"
        );
      }
    } finally {
      // Don't reset isSubmittingVote immediately to show loader for 3 seconds
      // The loading state will persist until showInviteCode is set to true
      setTimeout(() => {
        setIsSubmittingVote(false);
      }, 3000);
    }
  };

  // Add new useEffect for fetching token balance
  useEffect(() => {
    const fetchTokenBalance = async () => {
      if (smartAccount) {
        setIsLoadingBalance(true);
        try {
          const balance = await getUserTokenBalance(smartAccount);
          setTokenBalance(balance);
        } catch (err) {
          console.error("Error fetching token balance:", err);
        } finally {
          setIsLoadingBalance(false);
        }
      }
    };

    fetchTokenBalance();
  }, [smartAccount, txHash]); // Refresh balance after txHash changes (after airdrop)

  // Add polling effect for nominees and voting status
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;

    const pollData = async () => {
      // if (txHash) return; // Only poll if we have a transaction hash
      if (!txHash) return; // Only poll if we have a transaction hash

      try {
        // Fetch both nominees and voting status
        const [fetchedNominees, status] = await Promise.all([
          fetchNominees(),
          getVotingStatus(),
        ]);

        // Update nominees while preserving vote counts and upvoted states
        if (fetchedNominees) {
          setNominees((currentNominees) => {
            // Update nominees while preserving vote counts
            return fetchedNominees.map((newNominee) => {
              const existingNominee = currentNominees.find(
                (n) => n.id === newNominee.id
              );
              return {
                ...newNominee,
                // Preserve vote count if it exists
                voteCount: existingNominee?.voteCount || newNominee.voteCount,
                // Preserve vote percentage if it exists
                votePercentage:
                  existingNominee?.votePercentage || newNominee.votePercentage,
              };
            });
          });
        }

        // Update voting status
        setVotingStatus(status);
      } catch (error) {
        console.error("Error polling data:", error);
      }
    };

    // Start polling if we have a transaction hash
    if (txHash) {
      // Initial poll
      pollData();

      // Set up interval for subsequent polls
      pollInterval = setInterval(pollData, 5000000);
    }

    // Cleanup function to clear interval when component unmounts
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [txHash, nomineeVoteCounts]); // Dependencies include txHash and nomineeVoteCounts

  // Add polling effect for token balance
  useEffect(() => {
    let balanceInterval: NodeJS.Timeout;

    const pollBalance = async () => {
      if (!smartAccount) return;

      try {
        const newBalance = await getUserTokenBalance(smartAccount);
        setTokenBalance(newBalance);
      } catch (error) {
        console.error("Error polling balance:", error);
      }
    };

    // Start polling if we have a smart account
    if (smartAccount) {
      // Initial poll
      pollBalance();

      // Set up interval for subsequent polls
      balanceInterval = setInterval(pollBalance, 5000000);
    }

    // Cleanup function to clear interval when component unmounts
    return () => {
      if (balanceInterval) {
        clearInterval(balanceInterval);
      }
    };
  }, [smartAccount]);

  // Add window resize handler
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  // Agent Card Component
  const AgentCard = ({
    nominee,
    isSelected,
    onSelect,
  }: {
    nominee: Nominee;
    isSelected: boolean;
    onSelect: () => void;
  }) => (
    <div
      className={`w-[180px] h-[300px] rounded-lg overflow-hidden cursor-pointer transition-all duration-300 transform hover:scale-102 shadow-md ${
        isSelected
          ? "ring-2 ring-yellow-400"
          : "hover:ring-1 hover:ring-blue-300"
      }`}
      onClick={onSelect}
      style={{
        background: isSelected ? "#FFEB95" : "#FFFBEB",
        border: `2px solid ${isSelected ? "#E74C3C" : "#D1D5DB"}`,
      }}
    >
      {/* Card header with agent "team" */}
      <div
        className="w-full py-2 px-2 text-center"
        style={{
          background: isSelected ? "#E74C3C" : "#3B82F6",
          borderBottom: `2px solid ${isSelected ? "#C0392B" : "#2563EB"}`,
        }}
      >
        <h3 className="font-extrabold text-base text-white uppercase tracking-wider drop-shadow-sm">
          {nominee.name.split(" ")[0]}
        </h3>
      </div>

      {/* Card image/avatar */}
      <div className="relative px-2 py-3 bg-white h-[180px] flex items-center justify-center">
        <div className="w-full h-[160px] overflow-hidden flex items-center justify-center bg-gray-100">
          {nominee.imageUrl ? (
            <img
              src={nominee.imageUrl}
              alt={nominee.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                console.error(
                  `Failed to load image for ${nominee.name}:`,
                  nominee.imageUrl
                );
                // Replace with UI Avatars fallback on error
                e.currentTarget.onerror = null; // Prevent infinite error loop
                e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(nominee.name)}&background=random&size=200&color=fff&bold=true`;
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-200">
              <span className="text-5xl font-bold text-gray-500">
                {nominee.name.charAt(0)}
              </span>
            </div>
          )}
        </div>

        {/* Selection star */}
        {isSelected && (
          <div className="absolute top-2 right-2">
            <div className="w-10 h-10 flex items-center justify-center bg-yellow-500 text-white text-[9px] font-bold rounded-full transform rotate-12 shadow-md">
              <div className="transform -rotate-12">
                ALL
                <br />
                STAR
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Card footer with name */}
      <div
        className="p-2 text-center flex flex-col items-center justify-center"
        style={{
          background: isSelected ? "#FFEB95" : "#FFFBEB",
          height: "70px",
        }}
      >
        <p className="font-bold text-sm uppercase text-black leading-tight">
          {nominee.name}
        </p>
        <p className="text-xs text-gray-600 mt-1">@{nominee.twitterHandle}</p>
      </div>
    </div>
  );

  // Versus Display Component
  const VersusDisplay = () => {
    if (agentPairs.length === 0 || currentPairIndex >= agentPairs.length) {
      return (
        <div className="text-center py-8">
          <p className="text-gray-500">No agents available for voting.</p>
        </div>
      );
    }

    const currentPair = agentPairs[currentPairIndex];
    const leftSelected = currentPair.selectedId === currentPair.leftAgent.id;
    const rightSelected = currentPair.selectedId === currentPair.rightAgent.id;

    return (
      <div className="w-full animate-fadeIn">
        {/* Progress indicator */}
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-blue-600 mb-2">
            Battle {currentPairIndex + 1} of {agentPairs.length}
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-purple-500 h-2.5 rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${((currentPairIndex + 1) / agentPairs.length) * 100}%`,
              }}
            ></div>
          </div>
        </div>

        {/* Agent battle cards - horizontal layout with fixed spacing */}
        <div className="relative flex items-center justify-center gap-0 px-2 py-4 mb-2">
          {/* Left agent */}
          <div className="w-[42%] flex justify-end transform hover:rotate-[-2deg] transition-transform">
            <div
              className={`${leftSelected ? "z-10 scale-105" : "z-0"} transition-all duration-300`}
            >
              <AgentCard
                nominee={currentPair.leftAgent}
                isSelected={leftSelected}
                onSelect={() => handleAgentSelection(currentPair.leftAgent.id)}
              />
            </div>
          </div>

          {/* Center VS */}
          <div className="z-20 w-[16%] flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white font-extrabold text-xl shadow-xl border-4 border-white">
              VS
            </div>
          </div>

          {/* Right agent */}
          <div className="w-[42%] flex justify-start transform hover:rotate-[2deg] transition-transform">
            <div
              className={`${rightSelected ? "z-10 scale-105" : "z-0"} transition-all duration-300`}
            >
              <AgentCard
                nominee={currentPair.rightAgent}
                isSelected={rightSelected}
                onSelect={() => handleAgentSelection(currentPair.rightAgent.id)}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Add keyframes for animations
  const fadeInAnimation = `
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-fadeIn {
      animation: fadeIn 0.6s ease-out forwards;
    }
  `;

  const progressAnimation = `
    @keyframes progress {
      0% { width: 0%; }
      10% { width: 15%; }
      30% { width: 40%; }
      50% { width: 65%; }
      70% { width: 80%; }
      90% { width: 90%; }
      95% { width: 95%; } /* Pause at 95% to give a sense of waiting for completion */
      100% { width: 100%; }
    }
    .animate-progress {
      animation: progress 7s ease-out forwards;
      background: linear-gradient(90deg, rgba(59,130,246,1) 0%, rgba(147,51,234,1) 50%, rgba(236,72,153,1) 100%);
      background-size: 200% 100%;
      animation-timing-function: linear;
    }
  `;

  // Rendering for loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-gray-900 to-gray-800 text-white">
        <style jsx>{fadeInAnimation}</style>
        <style jsx>{progressAnimation}</style>
        <div className="max-w-md w-full flex flex-col items-center justify-center space-y-6 rounded-xl bg-gray-800/50 p-8 backdrop-blur-sm shadow-2xl border border-gray-700">
          <div className="flex flex-col items-center text-center space-y-4">
            <div
              className={`h-16 w-16 rounded-full border-t-2 border-b-2 border-blue-500 animate-spin shadow-lg ${loadingStep.includes("smart account") ? "animate-pulse" : ""}`}
            ></div>
            <h2 className="text-xl font-bold">{loadingStep}</h2>

            {/* Show progress bar for smart account preparation */}
            {loadingStep.includes("smart account") ||
            loadingStep.includes("champions") ? (
              <div className="w-full mt-4">
                <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 animate-progress"></div>
                </div>
                <p className="text-sm text-gray-400 mt-2 animate-fadeIn">
                  {loadingStep.includes("champions")
                    ? "Your champions await. Loading voting interface..."
                    : "Initializing your account in the background..."}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Main UI rendering
  return (
    <>
      {showConfetti && (
        <ReactConfetti
          width={windowSize.width}
          height={windowSize.height}
          recycle={false}
          numberOfPieces={500}
          gravity={0.2}
        />
      )}
      <div className="container mx-auto flex flex-col items-center justify-center min-h-screen p-4 bg-white">
        {/* Error Display */}
        {error && (
          <Card className="w-full max-w-[500px] bg-white border-red-200">
            <CardHeader className="bg-white py-3">
              <CardTitle className="text-lg text-red-600">
                Something went wrong
              </CardTitle>
            </CardHeader>
            <CardContent className="bg-white py-4">
              <div className="text-red-500 text-sm mb-4">{error}</div>
              <Button
                onClick={() => router.push(`/claim/${tokenId}`)}
                className="w-full px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Voting UI - Only displayed after setup is complete */}
        {!error && setupComplete && (
          <Card className="w-full max-w-[600px] border-0 shadow-lg bg-gradient-to-br from-white to-blue-50 overflow-hidden relative">
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500 opacity-10 rounded-full -mr-10 -mt-10"></div>
            <div className="absolute bottom-0 left-0 w-16 h-16 bg-purple-500 opacity-10 rounded-full -ml-8 -mb-8"></div>

            <CardHeader className="bg-transparent py-4 relative z-10 border-b border-blue-100">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500"></div>
              <CardTitle className="text-xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
                Agent Battle
              </CardTitle>
              <CardDescription className="text-sm text-center text-gray-600">
                Choose your favorite agent in each head-to-head matchup
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-5 relative z-10">
              <div className="space-y-5">
                {/* Vote error display */}
                {votingError && (
                  <div
                    className={`text-xs p-2.5 rounded-md border shadow-sm animate-fadeIn ${
                      votingError.includes("Successfully")
                        ? "text-green-600 bg-green-50 border-green-200"
                        : "text-red-500 bg-red-50 border-red-200"
                    }`}
                  >
                    {votingError}
                  </div>
                )}

                {/* Loading nominees or show submission in progress */}
                {isLoadingNominees || isSubmittingVote ? (
                  <div className="space-y-4 py-10 animate-pulse">
                    <div className="flex items-center justify-center">
                      <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-500 border-t-transparent shadow-md"></div>
                    </div>
                    <p className="text-center text-blue-600 font-medium">
                      {isSubmittingVote
                        ? "Processing your votes..."
                        : "Loading agents..."}
                    </p>
                    {isSubmittingVote && (
                      <div className="max-w-xs mx-auto">
                        <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                          <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-2.5 rounded-full animate-progress"></div>
                        </div>
                        <p className="text-xs text-center text-gray-500 mt-2">
                          Your votes are being recorded
                        </p>
                      </div>
                    )}
                  </div>
                ) : showInviteCode ? (
                  <div className="space-y-4 animate-fadeIn">
                    {/* Invite code display (kept as is) */}
                    <div className="text-center">
                      <div className="inline-block p-3 bg-green-100 rounded-full mb-2">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-8 w-8 text-green-500"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <h3 className="text-xl font-bold text-green-600 mb-2">
                        🎉 Congratulations! 🎉
                      </h3>
                      <p className="text-sm text-gray-600 mb-4">
                        You&apos;ve successfully voted! Here&apos;s your
                        exclusive invite code:
                      </p>
                      <div className="bg-gradient-to-r from-green-50 to-blue-50 p-5 rounded-lg border-2 border-green-200 shadow-inner relative">
                        <code className="text-2xl font-mono font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-600 to-blue-600">
                          {inviteCode}
                        </code>
                        <button
                          onClick={() => {
                            if (inviteCode) {
                              navigator.clipboard
                                .writeText(inviteCode)
                                .then(() => {
                                  console.log(
                                    "Successfully copied to clipboard:",
                                    inviteCode
                                  );
                                  // Show temporary copy feedback
                                  const target =
                                    document.getElementById("copy-feedback");
                                  if (target) {
                                    target.classList.remove("opacity-0");
                                    target.classList.add("opacity-100");
                                    setTimeout(() => {
                                      target.classList.remove("opacity-100");
                                      target.classList.add("opacity-0");
                                    }, 2000);
                                  }
                                })
                                .catch((err) => {
                                  console.error("Failed to copy:", err);
                                });
                            }
                          }}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1.5 bg-white hover:bg-gray-50 text-blue-600 rounded-md border border-blue-200 transition-all shadow-sm hover:shadow"
                          aria-label="Copy invite code"
                          title="Copy invite code"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                            />
                          </svg>
                        </button>
                        <div
                          id="copy-feedback"
                          className="absolute left-1/2 transform -translate-x-1/2 -bottom-8 bg-gray-800 text-white px-3 py-1 rounded text-xs opacity-0 transition-opacity duration-300"
                        >
                          Copied to clipboard!
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Use this code to invite others to join the voting
                        process
                      </p>
                      <a
                        href="https://discord.gg/MGRFbzTkaE"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-6 mb-4 py-2.5 px-5 bg-gradient-to-r from-[#5865F2] to-[#4752C4] hover:from-[#4752C4] hover:to-[#3c45a5] text-white text-sm font-medium rounded-lg flex items-center justify-center mx-auto w-full max-w-xs transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                      >
                        <svg
                          className="w-5 h-5 mr-2"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
                        </svg>
                        Join our Discord Community
                      </a>
                    </div>
                  </div>
                ) : nominees.length === 0 ? (
                  <div className="text-center text-gray-500 bg-gray-50 rounded-lg p-8 shadow-inner">
                    <div className="text-3xl mb-2">🏆</div>
                    <div className="text-base font-medium">
                      No agents found for voting
                    </div>
                    <div className="text-xs mt-1">
                      Please check back later for available agents.
                    </div>
                  </div>
                ) : (
                  <VersusDisplay />
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add the animations to a global style tag */}
      <style jsx global>{`
        body {
          background: linear-gradient(135deg, #f5f7ff 0%, #e3eeff 100%);
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes progress {
          0% {
            width: 0%;
          }
          10% {
            width: 15%;
          }
          30% {
            width: 40%;
          }
          50% {
            width: 65%;
          }
          70% {
            width: 80%;
          }
          90% {
            width: 90%;
          }
          95% {
            width: 95%;
          }
          100% {
            width: 100%;
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out forwards;
        }

        .animate-progress {
          animation: progress 7s ease-out forwards;
        }
      `}</style>
    </>
  );
}
