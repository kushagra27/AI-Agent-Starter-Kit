"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  submitVoteForNominee,
  submitNomination,
  getUserTokenBalance,
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
  const [isTweeting, setIsTweeting] = useState(false);
  const [tweetUrl, setTweetUrl] = useState<string | null>(null);
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [isLoadingNominees, setIsLoadingNominees] = useState(false);
  const [votingError, setVotingError] = useState<string | null>(null);
  const [upvotedIds, setUpvotedIds] = useState<number[]>([]);
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
  const nomineesPerPage = 2;

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

    // Try to load cached tweet URL
    const cachedTweetKey = `tweet_url_${tokenId}`;
    const cachedTweetUrl = sessionStorage.getItem(cachedTweetKey);
    if (cachedTweetUrl) {
      console.log("Using cached tweet URL from session storage");
      setTweetUrl(cachedTweetUrl);
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

  const handleTweet = async () => {
    if (!txHash || !profile) return;
    setIsTweeting(true);
    try {
      // Check if we already have a tweet URL for this token
      const cachedTweetKey = `tweet_url_${tokenId}`;
      const cachedTweetUrl = sessionStorage.getItem(cachedTweetKey);

      if (cachedTweetUrl) {
        console.log("Using cached tweet URL from session storage");
        setTweetUrl(cachedTweetUrl);
        return;
      }

      const token =
        searchParams.get("token") || sessionStorage.getItem("twitter_token");
      if (!token) {
        throw new Error("No token provided");
      }

      const response = await fetch("/api/auth/twitter/tweetCard", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-token": token,
        },
        body: JSON.stringify({ txHash, tokenId }),
      });

      if (!response.ok) throw new Error("Failed to send tweet");
      const data = await response.json();
      setTweetUrl(data.tweetUrl);

      // Cache the tweet URL
      sessionStorage.setItem(cachedTweetKey, data.tweetUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send tweet");
    } finally {
      setIsTweeting(false);
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
    // Calculate total votes
    const totalVotes = Object.values(nomineeVoteCounts).reduce(
      (sum, count) => sum + count,
      0
    );

    if (totalVotes <= 0 || !votingStatus.isVotingOpen) {
      return;
    }

    if (isSubmittingVote) {
      return;
    }

    setIsSubmittingVote(true);
    setVotingError(null);

    try {
      if (!smartAccount) {
        throw new Error("Smart account address not available");
      }

      // Get all nominees with non-zero votes
      const nomineesWithVotes = Object.entries(nomineeVoteCounts)
        .filter(([_, count]) => count > 0)
        .map(([id, count]) => ({
          id: parseInt(id),
          count: count,
        }));

      if (nomineesWithVotes.length === 0) {
        throw new Error("No votes to submit");
      }

      // Extract arrays for bulk voting
      const nomineeIds = nomineesWithVotes.map(({ id }) => id);
      const voteCounts = nomineesWithVotes.map(({ count }) => count);

      // Submit all votes in a single transaction
      const result = await submitVoteForNominee(
        nomineeIds,
        voteCounts,
        smartAccount
      );

      if (result.success) {
        // Add to upvoted IDs to show as voted in UI
        setUpvotedIds([...upvotedIds, ...nomineeIds]);

        // Reset all vote counts
        setNomineeVoteCounts({});

        // Show success message
        setVotingError(
          `Successfully submitted ${totalVotes} vote${totalVotes > 1 ? "s" : ""} for ${nomineeIds.length} nominee${nomineeIds.length > 1 ? "s" : ""}.`
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
      } else {
        throw new Error("Failed to submit votes");
      }
    } catch (err) {
      console.error("Vote submission error:", err);
      setVotingError(
        err instanceof Error
          ? `Failed to submit votes: ${err.message}`
          : "Failed to submit votes. Please try again."
      );
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
            // Create a map of current vote counts and upvoted states
            const currentVoteCounts = currentNominees.reduce(
              (acc, nominee) => {
                acc[nominee.id] = nomineeVoteCounts[nominee.id] || 0;
                return acc;
              },
              {} as Record<number, number>
            );

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
      pollInterval = setInterval(pollData, 5000);
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
      balanceInterval = setInterval(pollBalance, 5000);
    }

    // Cleanup function to clear interval when component unmounts
    return () => {
      if (balanceInterval) {
        clearInterval(balanceInterval);
      }
    };
  }, [smartAccount]);

  return (
    <div className="container mx-auto flex flex-col items-center justify-center min-h-screen p-2 space-y-2">
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
          {isLoadingAccount ? "Fetching Account..." : "Claim Test Vote Tokens"}
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
                  {error && <div className="text-red-500 text-xs">{error}</div>}
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

                      {!isLoadingNominees &&
                        !showNominationForm &&
                        votingStatus.totalVotes > 0 && (
                          <div className="text-xs text-gray-500 text-center">
                            Total votes:{" "}
                            {ethers.formatEther(
                              votingStatus.totalVotes.toString()
                            )}
                          </div>
                        )}

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
                            {paginatedNominees.map((nominee) => (
                              <div
                                key={nominee.id}
                                className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                                  upvotedIds.includes(nominee.id)
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
                                        handleVoteCountChange(nominee.id, -1);
                                      }}
                                      disabled={
                                        !votingStatus.isVotingOpen ||
                                        (nomineeVoteCounts[nominee.id] || 0) <=
                                          0
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
                                        handleVoteCountChange(nominee.id, 1);
                                      }}
                                      disabled={!votingStatus.isVotingOpen}
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
                    {!tweetUrl ? (
                      <Button
                        onClick={handleTweet}
                        disabled={isTweeting}
                        className="mt-2 bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white text-sm py-1.5"
                      >
                        {isTweeting ? (
                          <div className="flex items-center space-x-1.5">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            <span>Sending Tweet...</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1.5">
                            <svg
                              className="h-4 w-4"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                            </svg>
                            <span>Share on Twitter</span>
                          </div>
                        )}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => window.open(tweetUrl, "_blank")}
                        className="mt-2 bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white text-sm py-1.5"
                      >
                        <div className="flex items-center space-x-1.5">
                          <svg
                            className="h-4 w-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                          </svg>
                          <span>View Tweet</span>
                        </div>
                      </Button>
                    )}
                    {tweetUrl && (
                      <div className="text-xs text-green-500 mt-1">
                        🎉 Tweet sent successfully!
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
