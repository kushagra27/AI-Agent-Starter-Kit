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
  formatAddress,
  Nominee,
  getVotingStatus,
  VotingStatus,
  formatPercentage,
  formatTimeRemaining,
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
    walletAddress: "",
  });
  const [isSubmittingNomination, setIsSubmittingNomination] = useState(false);

  // Check for all cached data on component mount to bypass flow steps
  useEffect(() => {
    // Try to load cached smart account
    const cachedAccount = sessionStorage.getItem("smart_account");
    if (cachedAccount) {
      console.log("Using cached smart account from session storage");
      setSmartAccount(cachedAccount);
    }

    // Try to load cached transaction hash
    const cachedTxKey = `tx_hash_${tokenId}`;
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
      const cachedTxKey = `tx_hash_${tokenId}`;
      const cachedTxHash = sessionStorage.getItem(cachedTxKey);

      if (cachedTxHash) {
        console.log("Using cached transaction hash from session storage");
        setTxHash(cachedTxHash);
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      const response = await fetch(
        `/api/auth/twitter/sendAirdrop/${tokenId}/${smartAccount}`,
        {
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error("Failed to send airdrop");
      const { txHash } = await response.json();
      setTxHash(txHash);

      // Cache the transaction hash
      sessionStorage.setItem(cachedTxKey, txHash);
    } catch (err) {
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

  const handleSubmitVote = (nomineeId: number) => {
    const voteCount = nomineeVoteCounts[nomineeId] || 0;
    // if (voteCount <= 0 || !votingStatus.isVotingOpen) return;

    setVotingError(
      `Submitted ${voteCount} vote${voteCount > 1 ? "s" : ""} for ${
        nominees.find((n) => n.id === nomineeId)?.name || "nominee"
      }`
    );

    if (!upvotedIds.includes(nomineeId)) {
      setUpvotedIds([...upvotedIds, nomineeId]);
    }

    setNomineeVoteCounts((prev) => ({
      ...prev,
      [nomineeId]: 0,
    }));
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

  const handleSubmitNomination = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingNomination(true);

    // Just a mockup - this would connect to your contract in a real implementation
    setTimeout(() => {
      setVotingError(`Nomination submitted for ${nominationForm.name}`);
      setNominationForm({
        name: "",
        twitterHandle: "",
        walletAddress: "",
      });
      setShowNominationForm(false);
      setIsSubmittingNomination(false);
    }, 1000);
  };

  return (
    <div className="container mx-auto flex flex-col items-center justify-center min-h-screen p-4 space-y-4">
      {!smartAccount && (
        <Card className="w-full max-w-md bg-white border-gray-200">
          <CardHeader className="bg-white">
            <CardTitle>Twitter Authentication Success</CardTitle>
            <CardDescription>
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
          <CardContent className="bg-white">
            {error ? (
              <div className="text-red-500">{error}</div>
            ) : isLoading ? (
              <Card className="border-2 bg-white">
                <CardContent className="pt-6">
                  <div className="space-y-6">
                    <div className="text-sm text-center text-gray-500">
                      Loading your profile details...
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-4">
                        <Skeleton className="h-12 w-12 rounded-full" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-[200px]" />
                          <Skeleton className="h-4 w-[150px]" />
                        </div>
                      </div>
                      <Skeleton className="h-20 w-full" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : profile ? (
              <Card className="border-2 bg-white">
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div className="flex items-center space-x-4">
                      {profile.data.profile_image_url && (
                        <Image
                          src={profile.data.profile_image_url}
                          alt={profile.data.name}
                          className="h-12 w-12 rounded-full"
                          width={100}
                          height={100}
                        />
                      )}
                      <div>
                        <div className="font-medium">{profile.data.name}</div>
                        <div className="text-sm text-gray-500">
                          @{profile.data.username}
                        </div>
                      </div>
                    </div>
                    {profile.data.description && (
                      <p className="text-sm text-gray-700">
                        {profile.data.description}
                      </p>
                    )}
                    {profile.data.public_metrics && (
                      <div className="flex justify-between text-sm text-gray-500">
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
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {isLoadingAccount ? "Fetching Account..." : "Claim Airdrop"}
        </Button>
      )}

      {isLoadingAccount && (
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <Skeleton className="h-6 w-[300px] mx-auto" />
              <p className="mt-2 text-gray-500">
                Fetching your smart account address...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {smartAccount && (
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="break-all text-sm space-y-1">
                <div className="font-semibold">Smart Account:</div>
                <a
                  href={`https://basescan.org/address/${smartAccount}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  {smartAccount}
                </a>
              </div>
              {!txHash ? (
                <>
                  {error && <div className="text-red-500">{error}</div>}
                  <Button
                    onClick={handleSendAirdrop}
                    disabled={isSending}
                    className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
                  >
                    {isSending ? "Sending Airdrop..." : "Send to Address"}
                  </Button>
                </>
              ) : (
                <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-4">
                  <div className="flex flex-col space-y-2 text-center">
                    <div className="text-xl">🎊 Airdrop Successful! 🎊</div>
                    <div className="text-sm text-gray-500">
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
                    <div className="mt-6 space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-lg font-semibold">
                          {isLoadingNominees
                            ? "Loading Nominees..."
                            : "Community Nominees"}
                        </h3>

                        {!isLoadingNominees &&
                          votingStatus.isVotingOpen &&
                          votingStatus.endTime && (
                            <div className="text-sm text-green-600 font-medium">
                              {formatTimeRemaining(votingStatus.endTime)}
                            </div>
                          )}

                        {!isLoadingNominees && !votingStatus.isVotingOpen && (
                          <div className="text-sm text-amber-600 font-medium">
                            Voting is closed
                          </div>
                        )}
                      </div>

                      {!isLoadingNominees && votingStatus.totalVotes > 0 && (
                        <div className="text-sm text-gray-500 text-center">
                          Total votes: {votingStatus.totalVotes}
                        </div>
                      )}

                      {votingError && (
                        <div className="text-red-500 text-sm bg-red-50 p-2 rounded-md border border-red-100">
                          {votingError}
                        </div>
                      )}

                      <div className="space-y-3">
                        {isLoadingNominees ? (
                          Array(3)
                            .fill(0)
                            .map((_, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg animate-pulse"
                              >
                                <div className="flex flex-col space-y-2 flex-1">
                                  <div className="h-4 w-1/2 bg-gray-200 rounded"></div>
                                  <div className="h-3 w-1/3 bg-gray-200 rounded"></div>
                                </div>
                                <div className="h-6 w-6 bg-gray-200 rounded-full"></div>
                              </div>
                            ))
                        ) : nominees.length > 0 ? (
                          nominees.map((nominee) => (
                            <div
                              key={nominee.id}
                              className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                                upvotedIds.includes(nominee.id)
                                  ? "bg-pink-50 border border-pink-100"
                                  : "bg-gray-50 hover:bg-gray-100 border border-transparent"
                              }`}
                            >
                              <div className="flex flex-col">
                                <div className="flex items-center space-x-2">
                                  <div className="text-sm font-medium">
                                    {nominee.name}
                                  </div>
                                  {nominee.votePercentage > 15 && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                      {formatPercentage(nominee.votePercentage)}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  @{nominee.twitterHandle} •{" "}
                                  {formatAddress(nominee.walletAddress)}
                                </div>
                                {nominee.nominatedByTwitter && (
                                  <div className="text-xs text-gray-400 mt-1">
                                    Nominated by: @{nominee.nominatedByTwitter}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center">
                                <div className="flex items-center mr-3 bg-white border rounded-lg overflow-hidden shadow-sm">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleVoteCountChange(nominee.id, -1);
                                    }}
                                    // disabled={
                                    //   !votingStatus.isVotingOpen ||
                                    //   (nomineeVoteCounts[nominee.id] || 0) <= 0
                                    // }
                                    className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label="Decrease vote"
                                  >
                                    −
                                  </button>
                                  <span className="px-3 py-1 font-medium text-sm border-x">
                                    {nomineeVoteCounts[nominee.id] || 0}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleVoteCountChange(nominee.id, 1);
                                    }}
                                    // disabled={!votingStatus.isVotingOpen}
                                    className="px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                    aria-label="Increase vote"
                                  >
                                    +
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleSubmitVote(nominee.id);
                                  }}
                                  // disabled={
                                  //   !votingStatus.isVotingOpen ||
                                  //   (nomineeVoteCounts[nominee.id] || 0) === 0
                                  // }
                                  className={`text-xs font-medium py-1 px-3 rounded ${
                                    // !votingStatus.isVotingOpen ||
                                    (nomineeVoteCounts[nominee.id] || 0) === 0
                                      ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                                      : "bg-blue-500 text-white hover:bg-blue-600"
                                  }`}
                                >
                                  Vote
                                </button>

                                {/* <div className="ml-3 flex items-center space-x-1">
                                  <span
                                    className={`text-xs font-medium ${nominee.voteCount > 0 ? "text-gray-700" : "text-gray-400"}`}
                                  >
                                    {formatVoteCount(nominee.voteCount)}
                                  </span>
                                  <div
                                    className={`transition-colors ${upvotedIds.includes(nominee.id) ? "text-pink-500" : "text-gray-400"}`}
                                  >
                                    ❤️
                                  </div>
                                </div> */}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center text-gray-500 bg-gray-50 rounded-lg p-6">
                            <div className="text-2xl mb-2">🏆</div>
                            <div className="font-medium">No nominees found</div>
                            <div className="text-sm mt-1">
                              Nominations may not have started yet.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Nomination button and form */}
                    <div className="mt-6">
                      {!showNominationForm ? (
                        <button
                          type="button"
                          onClick={() => setShowNominationForm(true)}
                          className="w-full py-2 px-4 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center justify-center"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5 mr-2"
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
                      ) : (
                        <div className="bg-white rounded-lg border p-4 shadow-sm">
                          <div className="flex justify-between items-center mb-4">
                            <h4 className="font-medium">
                              Submit New Nomination
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowNominationForm(false)}
                              className="text-gray-500 hover:text-gray-700"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-5 w-5"
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
                            className="space-y-3"
                          >
                            <div>
                              <label
                                htmlFor="name"
                                className="block text-sm font-medium text-gray-700 mb-1"
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
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                placeholder="John Doe"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor="twitterHandle"
                                className="block text-sm font-medium text-gray-700 mb-1"
                              >
                                Twitter Handle
                              </label>
                              <div className="flex">
                                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                                  @
                                </span>
                                <input
                                  type="text"
                                  id="twitterHandle"
                                  name="twitterHandle"
                                  value={nominationForm.twitterHandle}
                                  onChange={handleNominationInputChange}
                                  required
                                  className="flex-1 px-3 py-2 border border-gray-300 rounded-r-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                  placeholder="username"
                                />
                              </div>
                            </div>

                            <div>
                              <label
                                htmlFor="walletAddress"
                                className="block text-sm font-medium text-gray-700 mb-1"
                              >
                                Wallet Address
                              </label>
                              <input
                                type="text"
                                id="walletAddress"
                                name="walletAddress"
                                value={nominationForm.walletAddress}
                                onChange={handleNominationInputChange}
                                required
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                placeholder="0x..."
                              />
                            </div>

                            <div className="flex justify-end">
                              <button
                                type="submit"
                                disabled={isSubmittingNomination}
                                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isSubmittingNomination ? (
                                  <>
                                    <svg
                                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
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
                                  "Submit Nomination"
                                )}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                    {!tweetUrl ? (
                      <Button
                        onClick={handleTweet}
                        disabled={isTweeting}
                        className="mt-4 bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white"
                      >
                        {isTweeting ? (
                          <div className="flex items-center space-x-2">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            <span>Sending Tweet...</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <svg
                              className="h-5 w-5"
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
                        className="mt-4 bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white"
                      >
                        <div className="flex items-center space-x-2">
                          <svg
                            className="h-5 w-5"
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
                      <div className="text-sm text-green-500 mt-2">
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
