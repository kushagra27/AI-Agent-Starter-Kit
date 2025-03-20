import { ethers } from "ethers";
import TokenVotingABI from "./TestTokenVotingABI.json";

export interface Nominee {
  id: number;
  name: string;
  twitterHandle: string;
  walletAddress: string;
  voteCount: number;
  votePercentage: number;
  nominatedByTwitter: string;
  nominatedByAddress: string;
}

export interface VotingStatus {
  isVotingOpen: boolean;
  endTime: number | null;
  totalVotes: number;
}

// Contract configuration
const CONTRACT_ADDRESS = "0xE5d871360EAd86ED64BE5561522b2ED2cdF042C6";
const NETWORK_URL = "https://sepolia.base.org";

// Create a provider and contract instance
const getProvider = () => {
  return new ethers.JsonRpcProvider(NETWORK_URL);
};

const getContract = (provider: ethers.Provider) => {
  return new ethers.Contract(CONTRACT_ADDRESS, TokenVotingABI, provider);
};

/**
 * Fetch all nominees from the contract
 */
export const fetchNominees = async (): Promise<Nominee[]> => {
  try {
    const provider = getProvider();
    const contract = getContract(provider);

    // Call the getAllNominees function
    const [
      ids,
      names,
      twitterHandles,
      walletAddresses,
      voteCounts,
      votePercentages,
      nominatedByTwitterHandles,
      nominatedByAddresses,
    ] = await contract.getAllNominees();

    // Format the nominees data
    const nominees: Nominee[] = ids.map(
      (id: ethers.BigNumberish, index: number) => ({
        id: Number(id),
        name: names[index],
        twitterHandle: twitterHandles[index],
        walletAddress: walletAddresses[index],
        voteCount: Number(voteCounts[index]),
        votePercentage: Number(votePercentages[index]),
        nominatedByTwitter: nominatedByTwitterHandles[index],
        nominatedByAddress: nominatedByAddresses[index],
      })
    );

    // Sort by vote count (descending)
    return nominees.sort((a, b) => b.voteCount - a.voteCount);
  } catch (error) {
    console.error("Error fetching nominees:", error);
    return [];
  }
};

/**
 * Get voting status information
 */
export const getVotingStatus = async (): Promise<VotingStatus> => {
  try {
    const provider = getProvider();
    const contract = getContract(provider);

    // Get voting status
    const isVotingOpen = await contract.votingOpen();
    const endTimeInSeconds = isVotingOpen
      ? Number(await contract.votingEndTime())
      : null;
    const totalVotes = Number(await contract.totalVotes());

    return {
      isVotingOpen,
      endTime: endTimeInSeconds,
      totalVotes,
    };
  } catch (error) {
    console.error("Error fetching voting status:", error);
    return {
      isVotingOpen: false,
      endTime: null,
      totalVotes: 0,
    };
  }
};

/**
 * Format the vote count for display
 */
export const formatVoteCount = (count: number): string => {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  } else if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
};

/**
 * Format the address for display
 */
export const formatAddress = (address: string): string => {
  if (!address) return "";
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

/**
 * Format percentage for display
 */
export const formatPercentage = (percentage: number): string => {
  return `${percentage.toFixed(1)}%`;
};

/**
 * Format timestamp to human-readable time remaining
 */
export const formatTimeRemaining = (endTimeInSeconds: number): string => {
  const now = Math.floor(Date.now() / 1000);
  const remainingSeconds = endTimeInSeconds - now;

  if (remainingSeconds <= 0) {
    return "Voting ended";
  }

  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h remaining`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  } else {
    return `${minutes}m remaining`;
  }
};

/**
 * Vote for a nominee (read-only for now, since we don't have wallet integration)
 */
export const simulateVoteForNominee = async (
  nomineeId: number
): Promise<boolean> => {
  try {
    // This is a mock function since we're not implementing the actual voting transaction
    // In a real implementation, you would:
    // 1. Connect to user's wallet (MetaMask or another provider)
    // 2. Create a signer from the provider
    // 3. Call the vote function with the appropriate arguments

    console.log(`Simulated vote for nominee ID: ${nomineeId}`);

    // Add a small delay to simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Return success for the simulation
    return true;
  } catch (error) {
    console.error("Error voting for nominee:", error);
    return false;
  }
};
