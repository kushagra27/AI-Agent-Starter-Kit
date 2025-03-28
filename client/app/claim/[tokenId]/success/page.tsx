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
import { Skeleton } from "@/components/ui/skeleton";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  fetchNominees,
  getVotingStatus,
  formatPercentage,
  formatTimeRemaining,
  submitNomination,
  getUserTokenBalance,
  submitVoteForNominee,
} from "@/app/utils/contractUtils";
import { getCollablandApiUrl } from "../../../../../server/src/utils";
import axios from "axios";
import { ethers } from "ethers";
import TestVoteTokenABI from "@/app/utils/TestVoteTokenABI.json";

// Contract addresses
const VOTE_TOKEN_ADDRESS = "0xb6a7325A1841f4097260599d76AaC8217e8C4762";

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
}

interface VotingStatus {
  isVotingOpen: boolean;
  endTime: number | null;
  totalVotes: number;
}

interface NomineeVote {
  nominee_id: number;
  vote_count: number;
}

interface VoteRecord {
  id: uuid;
  twitter_username: string;
  smart_account: string;
  token_id: string;
  vote_count: number;
  invite_code: string;
  created_at: string;
  discord_id: string | null;
  discord_username: string | null;
  discord_joined_at: string | null;
  collabland_evm_address: string | null;
  nominee_votes: NomineeVote[];
}

export default function SuccessPage() {
  const { tokenId } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [profile, setProfile] = useState<TwitterProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [smartAccount, setSmartAccount] = useState<string | null>(null);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [isLoadingNominees, setIsLoadingNominees] = useState(true);
  const [votingError, setVotingError] = useState<string | null>(null);
  const [votingStatus, setVotingStatus] = useState<VotingStatus>({
    isVotingOpen: false,
    endTime: null,
    totalVotes: 0,
  });
  const [nomineeVoteCounts, setNomineeVoteCounts] = useState<
    Record<number, number>
  >({});
  const [showNominationForm, setShowNominationForm] = useState(false);
  const [nominationForm, setNominationForm] = useState({
    name: "",
    twitterHandle: "",
  });
  const [isSubmittingNomination, setIsSubmittingNomination] = useState(false);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<string>("0");
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showInviteCode, setShowInviteCode] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const nomineesPerPage = 2;
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  });

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

  // Check for all cached data on component mount to bypass flow steps
  useEffect(() => {
    // Try to load cached smart account
    const cachedAccount = sessionStorage.getItem("smart_account");
    if (cachedAccount) {
      console.log("Using cached smart account from session storage");
      setSmartAccount(cachedAccount);
    }

    // Try to load cached transaction hash
    const cachedTxKey = `tx_hash_${smartAccount}_${tokenId}`;
    const cachedTxHash = sessionStorage.getItem(cachedTxKey);
    if (cachedTxHash) {
      console.log("Using cached transaction hash from session storage");
      setTxHash(cachedTxHash);
    }
  }, [tokenId]);

  useEffect(() => {
    const fetchTwitterProfile = async () => {
      try {
        // First check if we already have a profile in session storage
        const storedProfile = sessionStorage.getItem("twitter_profile");
        const storedToken = sessionStorage.getItem("twitter_token");

        if (storedProfile && storedToken) {
          console.log("Using stored Twitter profile from session storage");
          setProfile(JSON.parse(storedProfile));
          setIsLoading(false);
          return;
        }

        // Otherwise proceed with fetching from API
        const token = searchParams.get("token");
        if (!token) {
          throw new Error("No token provided");
        }
        // Store token in session storage
        sessionStorage.setItem("twitter_token", token);

        const response = await fetch(
          "/api/auth/twitter/success?token=" + token
        );

        if (!response.ok) {
          throw new Error("Failed to fetch profile");
        }

        const storedPkP = sessionStorage.getItem("pkp");
        if (!storedPkP) {
          await generatePkp();
        }

        const data = await response.json();
        setProfile(data.profile);
        sessionStorage.setItem("twitter_profile", JSON.stringify(data.profile));
      } catch (err) {
        // sessionStorage.removeItem("twitter_token");
        setError(err instanceof Error ? err.message : "Something went wrong");
        router.push(`/claim/${tokenId}`);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTwitterProfile();
  }, [searchParams]);

  const generatePkp = async () => {
    const client = axios.create({
      baseURL: process.env.COLLABLAND_API_URL || "https://api.collab.land",
      headers: {
        "X-API-KEY": process.env.COLLABLAND_API_KEY || "",
        "Content-Type": "application/json",
      },
      timeout: 5 * 60 * 1000,
    });
    const v2ApiUrl = getCollablandApiUrl().replace("v1", "v2");
    const accessToken = sessionStorage.getItem("twitter_token");

    // Submit the user operation to execute the nomination
    const { data } = await client.get(
      `${v2ApiUrl}/platform/accounts?platform=twitter`, // 84532 is Base Sepolia
      {
        headers: {
          "X-ACCESS-TOKEN": accessToken || "",
          "X-API-KEY": process.env.NEXT_PUBLIC_COLLABLAND_API_KEY! || "",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log("Generated PKP:", data);
    sessionStorage.setItem("pkp", data.pkpAddress);
    // sessionStorage.setItem("evm_address", data.evm.);
  };

  const handleGetSmartAccount = async () => {
    setIsLoadingAccount(true);
    try {
      // Check if we have a cached smart account address
      const cachedAccount = sessionStorage.getItem("smart_account");
      if (cachedAccount) {
        console.log("Using cached smart account from session storage");
        setSmartAccount(cachedAccount);
        return;
      }

      const response = await fetch(
        `/api/auth/twitter/getAccountAddress?userId=${profile?.data.id}`
      );
      if (!response.ok) throw new Error("Failed to fetch account");
      const { account } = await response.json();
      setSmartAccount(account);

      // Cache the account address
      sessionStorage.setItem("smart_account", account);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get account");
    } finally {
      setIsLoadingAccount(false);
    }
  };

  const handleSendAirdrop = async () => {
    if (!smartAccount) return;
    setIsSending(true);
    try {
      // Check if we already have a transaction hash for this token
      const cachedTxKey = `tx_hash_${smartAccount}_${tokenId}`;
      const cachedTxHash = sessionStorage.getItem(cachedTxKey);

      if (cachedTxHash) {
        console.log("Using cached transaction hash from session storage");
        setTxHash(cachedTxHash);
        return;
      }

      // Get the private key from environment variable
      const privateKey = process.env.NEXT_PUBLIC_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error(
          "Airdrop private key not configured. Please check your environment variables."
        );
      }

      // Connect to Base Sepolia
      const provider = new ethers.JsonRpcProvider(
        process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ||
          "https://sepolia.base.org"
      );
      const wallet = new ethers.Wallet(privateKey, provider);

      // Create contract instance
      const tokenContract = new ethers.Contract(
        VOTE_TOKEN_ADDRESS,
        TestVoteTokenABI,
        wallet
      );

      // Amount to send (1000 tokens with 18 decimals)
      const amount = ethers.parseUnits("10", 18);

      // Send the transaction
      const tx = await tokenContract.transfer(smartAccount, amount);
      console.log("Transaction sent:", tx.hash);

      // Wait for transaction to be mined
      const receipt = await tx.wait();
      console.log("Transaction confirmed:", receipt.hash);

      // Set the transaction hash
      setTxHash(receipt.hash);

      // Cache the transaction hash
      sessionStorage.setItem(cachedTxKey, receipt.hash);

      // Show loading state while refreshing balance
      setIsLoadingBalance(true);

      // Small delay to ensure the blockchain has updated
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Refresh token balance
      try {
        const newBalance = await getUserTokenBalance(smartAccount);
        setTokenBalance(newBalance);
      } catch (refreshError) {
        console.error("Error refreshing balance after airdrop:", refreshError);
        setError(
          "Airdrop successful but failed to refresh balance. Please refresh the page."
        );
      } finally {
        setIsLoadingBalance(false);
      }
    } catch (err) {
      console.error("Airdrop error:", err);
      setError(err instanceof Error ? err.message : "Failed to send airdrop");
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    const getNominees = async () => {
      if (txHash) {
        try {
          setIsLoadingNominees(true);

          // Fetch both nominees and voting status concurrently
          const [fetchedNominees, status] = await Promise.all([
            fetchNominees(),
            getVotingStatus(),
          ]);

          setNominees(fetchedNominees || []);
          setVotingStatus(status);
        } catch (err) {
          console.error("Error fetching nominees:", err);
        } finally {
          setIsLoadingNominees(false);
        }
      }
    };

    getNominees();
  }, [txHash, tokenId]);

  const handleVoteCountChange = (nomineeId: number, change: number) => {
    console.log(`Changing vote for nominee ${nomineeId} by ${change}`);
    setNomineeVoteCounts((prev) => {
      const currentCount = prev[nomineeId] || 0;
      const newCount = Math.max(0, currentCount + change); // Prevent negative votes
      console.log(`New count: ${newCount}`);
      return {
        ...prev,
        [nomineeId]: newCount,
      };
    });
  };

  const handleSubmitVote = async () => {
    try {
      if (!profile?.data.username || !smartAccount || !tokenId) {
        console.error("[Vote] Missing required data");
        return;
      }

      setIsSubmittingVote(true);
      setError(null);

      // Get all nominees with non-zero votes
      const nomineeVotes = Object.entries(nomineeVoteCounts)
        .filter(([_, count]) => count > 0)
        .map(([id, count]) => ({
          nominee_id: parseInt(id),
          vote_count: count,
        }));

      if (nomineeVotes.length === 0) {
        throw new Error("No votes to submit");
      }

      // Calculate total vote count
      const totalVoteCount = nomineeVotes.reduce(
        (sum, vote) => sum + vote.vote_count,
        0
      );

      // First submit the vote on-chain
      const voteResult = await submitVoteForNominee(
        nomineeVotes.map((vote) => vote.nominee_id),
        nomineeVotes.map((vote) => vote.vote_count),
        smartAccount
      );

      if (voteResult.success) {
        // Reset all vote counts
        setNomineeVoteCounts({});

        // Show success message
        setVotingError(
          `Successfully submitted ${totalVoteCount} vote${totalVoteCount > 1 ? "s" : ""} for ${nomineeVotes.length} nominee${nomineeVotes.length > 1 ? "s" : ""}.`
        );

        // Show loading state while refreshing data
        setIsLoadingNominees(true);
        setIsLoadingBalance(true);

        // Small delay to ensure the blockchain has updated
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Refresh both nominees list and token balance
        try {
          const [fetchedNominees, status, newBalance] = await Promise.all([
            fetchNominees(),
            getVotingStatus(),
            getUserTokenBalance(smartAccount),
          ]);

          setNominees(fetchedNominees || []);
          setVotingStatus(status);
          setTokenBalance(newBalance);
        } catch (refreshError) {
          console.error("Error refreshing data after vote:", refreshError);
          setVotingError(
            "Vote submitted but failed to refresh data. Please refresh the page."
          );
        } finally {
          setIsLoadingNominees(false);
          setIsLoadingBalance(false);
        }
      } else if (!voteResult.success) {
        throw new Error("Failed to submit vote on-chain");
      }

      // After successful on-chain vote, record in Supabase
      const response = await fetch("/api/auth/twitter/record-vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: profile.data.username,
          smartAccount,
          tokenId,
          voteCount: totalVoteCount,
          nomineeVotes,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to record vote in database");
      }

      const data = await response.json();
      if (data.success) {
        setVoteSubmitted(true);
        setInviteCode(data.data.inviteCode);
        setShowInviteCode(true);
        // Start confetti effect
        setShowConfetti(true);
        // Stop confetti after 5 seconds
        setTimeout(() => setShowConfetti(false), 5000);

        // Reset vote counts after successful submission
        setNomineeVoteCounts({});
      } else {
        throw new Error(data.error || "Failed to record vote");
      }
    } catch (error) {
      console.error("[Vote] Error:", error);
      setError("Failed to submit vote");
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleNominationInputChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const { name, value } = e.target;
    setNominationForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmitNomination = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingNomination(true);
    setVotingError(null);

    try {
      if (!smartAccount) {
        throw new Error("Smart account address not available");
      }

      const { name, twitterHandle } = nominationForm;

      const result = await submitNomination(name, twitterHandle, smartAccount);

      if (result.success) {
        // Show success message
        setVotingError(
          `Successfully nominated ${name} (@${twitterHandle}). Tx hash: ${result.txHash?.slice(0, 10)}...`
        );

        // Reset form
        setNominationForm({
          name: "",
          twitterHandle: "",
        });

        // Close the form
        setShowNominationForm(false);

        // Show loading state while refreshing data
        setIsLoadingNominees(true);
        setIsLoadingBalance(true);

        // Small delay to ensure the blockchain has updated
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Refresh both nominees list and token balance
        try {
          const [fetchedNominees, status, newBalance] = await Promise.all([
            fetchNominees(),
            getVotingStatus(),
            getUserTokenBalance(smartAccount),
          ]);

          setNominees(fetchedNominees || []);
          setVotingStatus(status);
          setTokenBalance(newBalance);
        } catch (refreshError) {
          console.error(
            "Error refreshing data after nomination:",
            refreshError
          );
          setVotingError(
            "Nomination submitted but failed to refresh data. Please refresh the page."
          );
        } finally {
          setIsLoadingNominees(false);
          setIsLoadingBalance(false);
        }
      } else {
        throw new Error("Failed to submit nomination to the blockchain");
      }
    } catch (err) {
      console.error("Nomination submission error:", err);
      setVotingError(
        err instanceof Error
          ? `Failed to submit nomination: ${err.message}`
          : "Failed to submit nomination. Please try again."
      );
    } finally {
      setIsSubmittingNomination(false);
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

  // Add function to manually refresh token balance
  const handleRefreshBalance = async () => {
    if (!smartAccount) return;

    setIsLoadingBalance(true);
    try {
      const balance = await getUserTokenBalance(smartAccount);
      setTokenBalance(balance);
    } catch (err) {
      console.error("Error refreshing token balance:", err);
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const paginatedNominees = nominees.slice(
    (currentPage - 1) * nomineesPerPage,
    currentPage * nomineesPerPage
  );

  const totalPages = Math.ceil(nominees.length / nomineesPerPage);

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
        {!smartAccount && (
          <Card className="w-full max-w-[500px] bg-white border-gray-200">
            <CardHeader className="bg-white py-3">
              <CardTitle className="text-lg">
                Twitter Authentication Success
              </CardTitle>
              <CardDescription className="text-xs">
                Token:{" "}
                <a
                  href={`https://wow.xyz/${tokenId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  {tokenId}
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="bg-white py-2">
              {error ? (
                <div className="text-red-500 text-sm">{error}</div>
              ) : isLoading ? (
                <Card className="border-2 bg-white">
                  <CardContent className="pt-3">
                    <div className="space-y-3">
                      <div className="text-xs text-center text-gray-500">
                        Loading your profile details...
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center space-x-3">
                          <Skeleton className="h-8 w-8 rounded-full" />
                          <div className="space-y-1">
                            <Skeleton className="h-3 w-[150px]" />
                            <Skeleton className="h-2 w-[100px]" />
                          </div>
                        </div>
                        <Skeleton className="h-12 w-full" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : profile ? (
                <Card className="border-2 bg-white">
                  <CardContent className="pt-3">
                    <div className="space-y-2">
                      <div className="flex items-center space-x-3">
                        {profile.data.profile_image_url && (
                          <Image
                            src={profile.data.profile_image_url}
                            alt={profile.data.name}
                            className="h-8 w-8 rounded-full"
                            width={32}
                            height={32}
                          />
                        )}
                        <div>
                          <div className="text-sm font-medium">
                            {profile.data.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            @{profile.data.username}
                          </div>
                        </div>
                      </div>
                      {profile.data.description && (
                        <p className="text-xs text-gray-700 line-clamp-2">
                          {profile.data.description}
                        </p>
                      )}
                      {profile.data.public_metrics && (
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>
                            {profile.data.public_metrics.followers_count}{" "}
                            followers
                          </span>
                          <span>
                            {profile.data.public_metrics.following_count}{" "}
                            following
                          </span>
                          <span>
                            {profile.data.public_metrics.tweet_count} tweets
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </CardContent>
          </Card>
        )}

        {profile && !smartAccount && (
          <Button
            onClick={handleGetSmartAccount}
            disabled={isLoadingAccount}
            className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {isLoadingAccount
              ? "Fetching Account..."
              : "Claim Test Vote Tokens"}
          </Button>
        )}

        {isLoadingAccount && (
          <Card className="w-full max-w-[500px]">
            <CardContent className="pt-3">
              <div className="text-center">
                <Skeleton className="h-4 w-[200px] mx-auto" />
                <p className="mt-1 text-xs text-gray-500">
                  Fetching your smart account address...
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {smartAccount && (
          <Card className="w-full max-w-[500px]">
            <CardContent className="pt-3">
              <div className="space-y-2">
                <div className="break-all text-xs space-y-0.5">
                  <div className="font-semibold">Smart Account:</div>
                  <a
                    href={`https://basescan.org/address/${smartAccount}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    {smartAccount}
                  </a>

                  {/* Add token balance display */}
                  <div className="mt-2 flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                    <div>
                      <div className="font-semibold text-xs">
                        Voting Token Balance:
                      </div>
                      <div className="text-sm font-bold text-blue-600">
                        {isLoadingBalance ? (
                          <div className="h-4 w-16 bg-gray-200 animate-pulse rounded"></div>
                        ) : (
                          `${parseFloat(tokenBalance).toFixed(2)} VOTE`
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleRefreshBalance}
                      disabled={isLoadingBalance}
                      className="p-1 bg-blue-100 rounded-full hover:bg-blue-200 transition-colors"
                      title="Refresh balance"
                    >
                      {isLoadingBalance ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4 text-blue-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                {!txHash ? (
                  <>
                    {error && (
                      <div className="text-red-500 text-xs">{error}</div>
                    )}
                    <Button
                      onClick={handleSendAirdrop}
                      disabled={isSending}
                      className="w-full px-3 py-1.5 bg-green-500 text-white text-sm rounded hover:bg-green-600 disabled:bg-gray-400"
                    >
                      {isSending ? "Sending Vote Tokens..." : "Send to Address"}
                    </Button>
                  </>
                ) : (
                  <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
                    <div className="flex flex-col space-y-1.5 text-center">
                      <div className="text-base">
                        🎊 Test Vote Tokens Sent! 🎊
                      </div>
                      <div className="text-xs text-gray-500">
                        View on BaseScan:{" "}
                        <a
                          href={`https://basescan.org/tx/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline break-all"
                        >
                          {txHash}
                        </a>
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="flex justify-between items-center">
                          <h3 className="text-sm font-semibold">
                            {isLoadingNominees
                              ? "Loading Nominees..."
                              : showNominationForm
                                ? "Submit New Nomination"
                                : "Community Nominees"}
                          </h3>

                          {!isLoadingNominees &&
                            !showNominationForm &&
                            votingStatus.isVotingOpen &&
                            votingStatus.endTime && (
                              <div className="text-xs text-green-600 font-medium">
                                {formatTimeRemaining(votingStatus.endTime)}
                              </div>
                            )}

                          {!isLoadingNominees &&
                            !showNominationForm &&
                            !votingStatus.isVotingOpen && (
                              <div className="text-xs text-amber-600 font-medium">
                                Voting is closed
                              </div>
                            )}
                        </div>

                        {/* {!isLoadingNominees &&
                          !showNominationForm &&
                          votingStatus.totalVotes > 0 && (
                            <div className="text-xs text-gray-500 text-center">
                              Total votes:{" "}
                              {ethers.formatEther(
                                votingStatus.totalVotes.toString()
                              )}
                            </div>
                          )} */}

                        {votingError && (
                          <div
                            className={`text-xs p-1.5 rounded-md border ${
                              votingError.includes("Successfully")
                                ? "text-green-600 bg-green-50 border-green-100"
                                : "text-red-500 bg-red-50 border-red-100"
                            }`}
                          >
                            {votingError}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          {isLoadingNominees ? (
                            Array(2)
                              .fill(0)
                              .map((_, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between p-2 bg-gray-50 rounded-lg animate-pulse"
                                >
                                  <div className="flex flex-col space-y-1 flex-1">
                                    <div className="h-3 w-1/2 bg-gray-200 rounded"></div>
                                    <div className="h-2 w-1/3 bg-gray-200 rounded"></div>
                                  </div>
                                  <div className="h-4 w-4 bg-gray-200 rounded-full"></div>
                                </div>
                              ))
                          ) : showNominationForm ? (
                            <div className="bg-white rounded-lg border p-3 shadow-sm">
                              <div className="flex justify-between items-center mb-2">
                                <h4 className="font-medium text-sm">
                                  Submit New Nomination
                                </h4>
                                <button
                                  type="button"
                                  onClick={() => setShowNominationForm(false)}
                                  className="text-gray-500 hover:text-gray-700"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 w-4"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </button>
                              </div>

                              <form
                                onSubmit={handleSubmitNomination}
                                className="space-y-2"
                              >
                                <div>
                                  <label
                                    htmlFor="name"
                                    className="block text-xs font-medium text-gray-700 mb-0.5"
                                  >
                                    Name
                                  </label>
                                  <input
                                    type="text"
                                    id="name"
                                    name="name"
                                    value={nominationForm.name}
                                    onChange={handleNominationInputChange}
                                    required
                                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="John Doe"
                                  />
                                </div>

                                <div>
                                  <label
                                    htmlFor="twitterHandle"
                                    className="block text-xs font-medium text-gray-700 mb-0.5"
                                  >
                                    Twitter Handle
                                  </label>
                                  <div className="flex">
                                    <span className="inline-flex items-center px-2 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-xs">
                                      @
                                    </span>
                                    <input
                                      type="text"
                                      id="twitterHandle"
                                      name="twitterHandle"
                                      value={nominationForm.twitterHandle}
                                      onChange={handleNominationInputChange}
                                      required
                                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded-r-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      placeholder="username"
                                    />
                                  </div>
                                </div>

                                <div className="flex justify-end">
                                  <button
                                    type="submit"
                                    disabled={isSubmittingNomination}
                                    className="inline-flex justify-center py-1.5 px-3 border border-transparent shadow-sm text-xs font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={handleSubmitNomination}
                                  >
                                    {isSubmittingNomination ? (
                                      <>
                                        <svg
                                          className="animate-spin -ml-1 mr-1.5 h-3 w-3 text-white"
                                          xmlns="http://www.w3.org/2000/svg"
                                          fill="none"
                                          viewBox="0 0 24 24"
                                        >
                                          <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                          ></circle>
                                          <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                          ></path>
                                        </svg>
                                        Submitting...
                                      </>
                                    ) : (
                                      "Submit Nomination (5 $VOTE)"
                                    )}
                                  </button>
                                </div>
                              </form>
                            </div>
                          ) : nominees.length > 0 ? (
                            <>
                              {showInviteCode ? (
                                <div className="space-y-2">
                                  <div className="text-center">
                                    <h3 className="text-lg font-semibold text-green-600 mb-2">
                                      🎉 Congratulations! 🎉
                                    </h3>
                                    <p className="text-sm text-gray-600 mb-4">
                                      You&apos;ve successfully voted!
                                      Here&apos;s your exclusive invite code to
                                      play with agents:
                                    </p>
                                    <div className="bg-gray-50 p-4 rounded-lg border-2 border-green-200">
                                      <code className="text-2xl font-mono font-bold text-green-600">
                                        {inviteCode}
                                      </code>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                      Use this code with{" "}
                                      <code className="text-green-600">
                                        /invite {inviteCode}
                                      </code>{" "}
                                      in our discord to claim your rewards!
                                    </p>
                                    <a
                                      href="https://discord.gg/hellomother"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-4 mb-4 py-2 px-4 bg-[#5865F2] hover:bg-[#4752C4] text-white text-sm rounded-lg flex items-center justify-center mx-auto w-full max-w-xs transition-colors"
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
                                    <Button
                                      onClick={() => setShowInviteCode(false)}
                                      className="mt-2 py-1.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg flex items-center justify-center mx-auto"
                                    >
                                      <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        className="h-4 w-4 mr-1.5"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                      >
                                        <path
                                          fillRule="evenodd"
                                          d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                      Back to Voting
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {paginatedNominees.map((nominee) => (
                                    <div
                                      key={nominee.id}
                                      className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                                        votingStatus.isVotingOpen &&
                                        votingStatus.endTime &&
                                        nomineeVoteCounts[nominee.id] > 0
                                          ? "bg-pink-50 border border-pink-100"
                                          : "bg-gray-50 hover:bg-gray-100 border border-transparent"
                                      }`}
                                    >
                                      <div className="flex flex-col">
                                        <div className="flex items-center space-x-1.5">
                                          <div className="text-xs font-medium">
                                            {nominee.name}
                                          </div>
                                          {nominee.votePercentage > 15 && (
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
                                              {formatPercentage(
                                                nominee.votePercentage
                                              )}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[10px] text-gray-500">
                                          @{nominee.twitterHandle}
                                        </div>
                                        {nominee.nominatedByTwitter && (
                                          <div className="text-[10px] text-gray-400">
                                            Nominated by: @
                                            {nominee.nominatedByTwitter}
                                          </div>
                                        )}
                                      </div>

                                      <div className="flex items-center">
                                        <div className="flex items-center mr-2 bg-white border rounded-lg overflow-hidden shadow-sm">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleVoteCountChange(
                                                nominee.id,
                                                -1
                                              );
                                            }}
                                            disabled={
                                              !votingStatus.isVotingOpen ||
                                              (nomineeVoteCounts[nominee.id] ||
                                                0) <= 0
                                            }
                                            className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                                            aria-label="Decrease vote"
                                          >
                                            −
                                          </button>
                                          <span className="px-2 py-0.5 font-medium text-xs border-x">
                                            {nomineeVoteCounts[nominee.id] || 0}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleVoteCountChange(
                                                nominee.id,
                                                1
                                              );
                                            }}
                                            disabled={
                                              !votingStatus.isVotingOpen
                                            }
                                            className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                                            aria-label="Increase vote"
                                          >
                                            +
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}

                                  {/* Pagination Controls */}
                                  {totalPages > 1 && (
                                    <div className="flex items-center justify-center space-x-2 mt-2">
                                      <button
                                        onClick={() =>
                                          setCurrentPage((prev) =>
                                            Math.max(prev - 1, 1)
                                          )
                                        }
                                        disabled={currentPage === 1}
                                        className="px-2 py-1 text-xs rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        Previous
                                      </button>
                                      <span className="text-xs text-gray-600">
                                        Page {currentPage} of {totalPages}
                                      </span>
                                      <button
                                        onClick={() =>
                                          setCurrentPage((prev) =>
                                            Math.min(prev + 1, totalPages)
                                          )
                                        }
                                        disabled={currentPage === totalPages}
                                        className="px-2 py-1 text-xs rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        Next
                                      </button>
                                    </div>
                                  )}

                                  {/* Consolidated Vote Button */}
                                  <div className="mt-2 flex justify-center">
                                    <button
                                      type="button"
                                      onClick={handleSubmitVote}
                                      disabled={
                                        !votingStatus.isVotingOpen ||
                                        Object.values(nomineeVoteCounts).reduce(
                                          (sum, count) => sum + count,
                                          0
                                        ) === 0 ||
                                        isSubmittingVote
                                      }
                                      className={`w-full py-1.5 px-3 rounded-lg font-medium text-sm ${
                                        !votingStatus.isVotingOpen ||
                                        Object.values(nomineeVoteCounts).reduce(
                                          (sum, count) => sum + count,
                                          0
                                        ) === 0 ||
                                        isSubmittingVote
                                          ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                                          : "bg-blue-500 text-white hover:bg-blue-600"
                                      }`}
                                    >
                                      {isSubmittingVote ? (
                                        <div className="flex items-center justify-center">
                                          <div className="h-3 w-3 mr-1.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                                          <span>Submitting Votes...</span>
                                        </div>
                                      ) : (
                                        `Submit ${Object.values(nomineeVoteCounts).reduce((sum, count) => sum + count, 0)} Votes`
                                      )}
                                    </button>
                                  </div>

                                  {/* Nomination Button */}
                                  <button
                                    type="button"
                                    onClick={() => setShowNominationForm(true)}
                                    className="w-full py-1.5 px-3 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg flex items-center justify-center mt-2"
                                  >
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      className="h-4 w-4 mr-1.5"
                                      viewBox="0 0 20 20"
                                      fill="currentColor"
                                    >
                                      <path
                                        fillRule="evenodd"
                                        d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                                        clipRule="evenodd"
                                      />
                                    </svg>
                                    Submit New Nomination
                                  </button>

                                  {!showInviteCode && (
                                    <Button
                                      onClick={() => setShowInviteCode(true)}
                                      disabled={!voteSubmitted}
                                      className={`mt-2 ${
                                        voteSubmitted
                                          ? "bg-green-500 hover:bg-green-600"
                                          : "bg-gray-300 cursor-not-allowed"
                                      } text-white text-sm py-1.5 w-full`}
                                    >
                                      <div className="flex items-center space-x-1.5 justify-center">
                                        <svg
                                          xmlns="http://www.w3.org/2000/svg"
                                          className="h-4 w-4"
                                          viewBox="0 0 20 20"
                                          fill="currentColor"
                                        >
                                          <path
                                            fillRule="evenodd"
                                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z"
                                            clipRule="evenodd"
                                          />
                                        </svg>
                                        <span>Claim Rewards</span>
                                      </div>
                                    </Button>
                                  )}
                                </>
                              )}
                            </>
                          ) : (
                            <div className="text-center text-gray-500 bg-gray-50 rounded-lg p-3">
                              <div className="text-xl mb-1">🏆</div>
                              <div className="text-sm font-medium">
                                No nominees found
                              </div>
                              <div className="text-xs mt-0.5">
                                Nominations may not have started yet.
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowNominationForm(true)}
                                className="mt-2 py-1.5 px-3 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg flex items-center justify-center mx-auto"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className="h-4 w-4 mr-1.5"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                                Submit New Nomination
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        {voteSubmitted && (
          <div className="mt-4 p-4 bg-green-100 text-green-700 rounded">
            Vote submitted successfully!
          </div>
        )}
        {error && (
          <div className="mt-4 p-4 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}
      </div>
    </>
  );
}
