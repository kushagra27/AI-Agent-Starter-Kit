import { ethers } from "ethers";
import TokenVotingABI from "./TestTokenVotingABI.json";
import VoteTokenABI from "./TestVoteTokenABI.json";
import axios from "axios";
import { getCollablandApiUrl } from "../../../server/src/utils";

export interface Nominee {
  id: number;
  name: string;
  twitterHandle: string;
  voteCount: number;
  votePercentage: number;
  nominatedByTwitter?: string;
}

export interface VotingStatus {
  isVotingOpen: boolean;
  endTime: number | null;
  totalVotes: number;
}

export interface VoteResult {
  nomineeIds: number[];
  voteCounts: number[];
  txHash?: string;
  success: boolean;
}

export interface NominationResult {
  name: string;
  twitterHandle: string;
  txHash?: string;
  success: boolean;
}

// Contract configuration
const VOTING_CONTRACT_ADDRESS = "0x5AAe49de6e706eda7D890697ba3297fBBF81CB93";
const VOTE_TOKEN_ADDRESS = "0xb6a7325A1841f4097260599d76AaC8217e8C4762";
const NETWORK_URL = "https://sepolia.base.org";

// Create a provider and contract instance
const getProvider = () => {
  return new ethers.JsonRpcProvider(NETWORK_URL);
};

const getVotingContract = (provider: ethers.Provider) => {
  return new ethers.Contract(VOTING_CONTRACT_ADDRESS, TokenVotingABI, provider);
};

const getTokenContract = (provider: ethers.Provider) => {
  return new ethers.Contract(VOTE_TOKEN_ADDRESS, VoteTokenABI, provider);
};

/**
 * Fetch all nominees from the contract
 */
export const fetchNominees = async (): Promise<Nominee[]> => {
  try {
    const provider = getProvider();
    const contract = getVotingContract(provider);

    // Call the getAllNominees function
    const [
      ids,
      names,
      twitterHandles,
      voteCounts,
      votePercentages,
      nominatedByTwitterHandles,
    ] = await contract.getAllNominees();

    // Format the nominees data
    const nominees: Nominee[] = ids.map(
      (id: ethers.BigNumberish, index: number) => ({
        id: Number(id),
        name: names[index],
        twitterHandle: twitterHandles[index],
        voteCount: Number(voteCounts[index]),
        votePercentage: Number(votePercentages[index]),
        nominatedByTwitter: nominatedByTwitterHandles[index],
      })
    );


    

    // Sort by vote count (descending)
    // return nominees.sort((a, b) => b.voteCount - a.voteCount);
    return nominees;
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
    const contract = getVotingContract(provider);

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
    console.error("Error getting voting status:", error);
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
 * Format time remaining for display
 */
export const formatTimeRemaining = (endTimeInSeconds: number): string => {
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = endTimeInSeconds - now;

  if (timeLeft <= 0) return "Voting ended";

  const days = Math.floor(timeLeft / (24 * 60 * 60));
  const hours = Math.floor((timeLeft % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((timeLeft % (60 * 60)) / 60);
  const seconds = timeLeft % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
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

/**
 * Submit a vote for a nominee
 */
export const submitVoteForNominee = async (
  nomineeIds: number[],
  voteCounts: number[],
  _userAccountAddress: string // Prefix with _ to indicate intentionally unused
): Promise<VoteResult> => {
  try {
    // Get the user's smart account address from session storage
    const smartAccountAddress = sessionStorage.getItem("smart_account");
    if (!smartAccountAddress) {
      throw new Error("Smart account address not found");
    }

    // Create an Axios client for API requests
    const client = axios.create({
      baseURL:
        process.env.COLLABLAND_API_URL ||
        "https://api-qa.collab.land/accountkit/v1",
      headers: {
        "X-API-KEY": process.env.NEXT_PUBLIC_COLLABLAND_API_KEY || "",
        "X-TG-BOT-TOKEN": process.env.NEXT_PUBLIC_TG_BOT_TOKEN || "",
        "Content-Type": "application/json",
      },
      timeout: 5 * 60 * 1000,
    });

    // Get the access token from session storage
    const accessToken = sessionStorage.getItem("twitter_token");
    if (!accessToken) {
      throw new Error("Twitter access token not found");
    }

    // Define the contract interface for the bulkVoteFor function
    const bulkVoteForInterface = new ethers.Interface([
      "function bulkVoteFor(address _voter, uint256[] memory _nomineeIds, uint256[] memory _amounts) external",
    ]);

    // Define the contract interface for the approve function
    const approveInterface = new ethers.Interface([
      "function approve(address spender, uint256 amount) external returns (bool)",
    ]);

    // Encode the function calls
    const bulkVoteForData = bulkVoteForInterface.encodeFunctionData(
      "bulkVoteFor",
      [
        smartAccountAddress,
        nomineeIds,
        voteCounts.map((count) => ethers.parseEther(count.toString())),
      ]
    );

    const totalVoteCounts = voteCounts.reduce((a, b) => a + b, 0);

    const approveData = approveInterface.encodeFunctionData("approve", [
      VOTING_CONTRACT_ADDRESS,
      ethers.parseEther(totalVoteCounts.toString()),
    ]);

    // Prepare the payload for the user operation
    const payload = {
      userOps: [
        {
          target: VOTE_TOKEN_ADDRESS,
          calldata: approveData,
          value: "0",
        },
        {
          target: VOTING_CONTRACT_ADDRESS,
          calldata: bulkVoteForData,
          value: "0",
        },
      ],
    };

    console.log("Submitting vote UserOperation:", payload);

    const v2ApiUrl = getCollablandApiUrl().replace("v1", "v2");

    // Added retry logic for submitting user operation
    let userOpHash = null;
    let userOpData = null;
    let submissionRetries = 0;
    const maxSubmissionRetries = 7;
    const retryDelay = 3000; // 3 seconds between retries

    while (submissionRetries < maxSubmissionRetries) {
      try {
        // Submit the user operation to execute the vote
        const { data } = await client.post(
          `${v2ApiUrl}/platform/evm/submitUserOperation?chainId=84532&platform=twitter`, // 84532 is Base Sepolia
          payload,
          {
            headers: {
              "X-ACCESS-TOKEN": accessToken,
              "X-API-KEY": process.env.NEXT_PUBLIC_COLLABLAND_API_KEY! || "",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          }
        );

        userOpData = data;
        userOpHash = data.userOperationHash;

        if (userOpHash) {
          console.log("UserOperation submitted successfully:", userOpData);
          break;
        } else {
          console.warn(
            `UserOperation hash not received (attempt ${submissionRetries + 1}/${maxSubmissionRetries})`
          );
        }
      } catch (err) {
        console.error(
          `Error submitting UserOperation (attempt ${submissionRetries + 1}/${maxSubmissionRetries}):`,
          err
        );
      }

      submissionRetries++;
      console.log(
        `Retrying submission in ${retryDelay / 1000} seconds... (${submissionRetries}/${maxSubmissionRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    // try {
    //   // Submit the user operation to execute the vote
    //   const { data } = await client.post(
    //     `${v2ApiUrl}/platform/evm/submitUserOperation?chainId=84532&platform=twitter`, // 84532 is Base Sepolia
    //     payload,
    //     {
    //       headers: {
    //         "X-ACCESS-TOKEN": accessToken,
    //         "X-API-KEY": process.env.NEXT_PUBLIC_COLLABLAND_API_KEY! || "",
    //         "Content-Type": "application/json",
    //         Accept: "application/json",
    //       },
    //     }
    //   );

    //   userOpData = data;
    //   userOpHash = data.userOperationHash;

    //   if (userOpHash) {
    //     console.log("UserOperation submitted successfully:", userOpData);
    //   } else {
    //     console.warn(`UserOperation hash not received (attempt )`);
    //   }
    // } catch (err) {
    //   console.error(`Error submitting UserOperation (attempt :`, err);
    // }
    // // console.log(
    // //   `Retrying submission in ${retryDelay / 1000} seconds... (${submissionRetries}/${maxSubmissionRetries})`
    // // );
    // // await new Promise((resolve) => setTimeout(resolve, retryDelay));
    // // }

    if (!userOpHash) {
      console.error("Failed to submit UserOperation after multiple attempts");
      return {
        nomineeIds,
        voteCounts,
        success: false,
      };
    }

    console.log("UserOperation submitted:", userOpData);

    // Wait for the user operation to complete
    let receipt = null;
    try {
      console.log("Fetching receipt for UserOperation:", userOpHash);
      const receiptResponse = await client.get(
        `/telegrambot/evm/userOperationReceipt?chainId=84532&userOperationHash=${userOpHash}`
      );

      console.log("Receipt fetched:", receiptResponse.data);
      receipt = receiptResponse.data;
    } catch (err) {
      console.error(`Error fetching receipt:`, err);
    }

    if (!receipt || !receipt.success) {
      console.error("Failed to submit votes. Operation timed out or failed.");
      return {
        nomineeIds,
        voteCounts,
        success: false,
      };
    }

    console.log("Vote submitted successfully:", receipt);
    return {
      nomineeIds,
      voteCounts,
      txHash: receipt.receipt?.transactionHash,
      success: true,
    };
  } catch (error) {
    console.error("Failed to submit votes:", error);
    return {
      nomineeIds,
      voteCounts,
      success: false,
    };
  }
};

/**
 * Submit a nomination
 */
export const submitNomination = async (
  name: string,
  twitterHandle: string,
  _userAccountAddress: string // Prefix with _ to indicate intentionally unused
): Promise<NominationResult> => {
  try {
    // Get the user's smart account address from session storage
    const smartAccountAddress = sessionStorage.getItem("smart_account");
    if (!smartAccountAddress) {
      throw new Error("Smart account address not found");
    }

    // Get the nominator's Twitter handle from session storage
    const nominatorTwitterHandle = JSON.parse(
      sessionStorage.getItem("twitter_profile") || ""
    ).data.username;
    if (!nominatorTwitterHandle) {
      throw new Error("Twitter handle not found");
    }

    // Create an Axios client for API requests
    const client = axios.create({
      baseURL:
        process.env.COLLABLAND_API_URL ||
        "https://api-qa.collab.land/accountkit/v1",
      headers: {
        "X-API-KEY": process.env.NEXT_PUBLIC_COLLABLAND_API_KEY || "",
        "X-TG-BOT-TOKEN": process.env.NEXT_PUBLIC_TG_BOT_TOKEN || "",
        "Content-Type": "application/json",
      },
      timeout: 5 * 60 * 1000,
    });

    // Get the access token from session storage
    const accessToken = sessionStorage.getItem("twitter_token");
    if (!accessToken) {
      throw new Error("Twitter access token not found");
    }

    // Define the contract interface for the nominate function
    const nominateInterface = new ethers.Interface([
      "function submitNominationFrom(address _nominator, string memory _name, string memory _nomineeTwitter, string memory _nominatorTwitter) external",
    ]);
    // Encode the function calls
    const nominateData = nominateInterface.encodeFunctionData(
      "submitNominationFrom",
      [smartAccountAddress, name, twitterHandle, nominatorTwitterHandle]
    );

    // Define the contract interface for the approve function
    const approveInterface = new ethers.Interface([
      "function approve(address spender, uint256 amount) external returns (bool)",
    ]);

    const approveData = approveInterface.encodeFunctionData("approve", [
      VOTING_CONTRACT_ADDRESS,
      ethers.parseEther("5"), // Cost of nomination in tokens
    ]);

    // Prepare the payload for the user operation
    const payload = {
      userOps: [
        {
          target: VOTE_TOKEN_ADDRESS,
          calldata: approveData,
          value: "0",
        },
        {
          target: VOTING_CONTRACT_ADDRESS,
          calldata: nominateData,
          value: "0",
        },
      ],
    };

    console.log("Payload:", payload);

    console.log("Submitting nomination UserOperation:", payload);

    const v2ApiUrl = getCollablandApiUrl().replace("v1", "v2");
    console.log("v2ApiUrl:", v2ApiUrl);

    // Added retry logic for submitting user operation
    let userOpHash = null;
    let userOpData = null;
    let submissionRetries = 0;
    const maxSubmissionRetries = 7;
    const retryDelay = 3000; // 3 seconds between retries

    while (submissionRetries < maxSubmissionRetries) {
      try {
        // Submit the user operation to execute the nomination
        const { data } = await client.post(
          `${v2ApiUrl}/platform/evm/submitUserOperation?chainId=84532&platform=twitter`, // 84532 is Base Sepolia
          payload,
          {
            headers: {
              "X-ACCESS-TOKEN": accessToken,
              "X-API-KEY": process.env.NEXT_PUBLIC_COLLABLAND_API_KEY! || "",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          }
        );

        userOpData = data;
        userOpHash = data.userOperationHash;

        if (userOpHash) {
          console.log("UserOperation submitted successfully:", userOpData);
          break;
        } else {
          console.warn(
            `UserOperation hash not received (attempt ${submissionRetries + 1}/${maxSubmissionRetries})`
          );
        }
      } catch (err) {
        console.error(
          `Error submitting UserOperation (attempt ${submissionRetries + 1}/${maxSubmissionRetries}):`,
          err
        );
      }

      submissionRetries++;
      console.log(
        `Retrying submission in ${retryDelay / 1000} seconds... (${submissionRetries}/${maxSubmissionRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    if (!userOpHash) {
      console.error("Failed to submit UserOperation after multiple attempts");
      return {
        name,
        twitterHandle,
        success: false,
      };
    }

    console.log("UserOperation submitted:", userOpData);

    // Wait for the user operation to complete
    let receipt = null;
    try {
      console.log("Fetching receipt for UserOperation:", userOpHash);
      const receiptResponse = await client.get(
        `/telegrambot/evm/userOperationReceipt?chainId=84532&userOperationHash=${userOpHash}`
      );

      console.log("Receipt fetched:", receiptResponse.data);
      receipt = receiptResponse.data;
    } catch (err) {
      console.error(`Error fetching receipt:`, err);
    }

    if (!receipt || !receipt.success) {
      console.error(
        "Failed to submit nomination. Operation timed out or failed."
      );
      return {
        name,
        twitterHandle,
        success: false,
      };
    }

    console.log("Nomination submitted successfully:", receipt);
    return {
      name,
      twitterHandle,
      txHash: receipt.receipt?.transactionHash,
      success: true,
    };
  } catch (error) {
    console.error("Failed to submit nomination:", error);
    return {
      name,
      twitterHandle,
      success: false,
    };
  }
};

/**
 * Get user's token balance
 */
export const getUserTokenBalance = async (address: string): Promise<string> => {
  try {
    const provider = getProvider();
    const contract = getTokenContract(provider);
    const balance = await contract.balanceOf(address);
    return ethers.formatUnits(balance, 18);
  } catch (error) {
    console.error("Error getting token balance:", error);
    return "0";
  }
};
