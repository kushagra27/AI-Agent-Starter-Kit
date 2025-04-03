import axios from "axios";
import { ethers } from "ethers";
import { BaseService } from "./base.service.js";

// Contract addresses
const VOTE_TOKEN_ADDRESS =
  process.env.VOTE_TOKEN_ADDRESS ||
  "0xb6a7325A1841f4097260599d76AaC8217e8C4762";
const VOTING_CONTRACT_ADDRESS =
  process.env.VOTING_CONTRACT_ADDRESS ||
  "0x5AAe49de6e706eda7D890697ba3297fBBF81CB93";

// Interfaces
interface NomineeVote {
  nominee_id: number;
  vote_count: number;
}

interface VoteResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export class VoteService extends BaseService {
  private static instance: VoteService;
  private serviceName = "Vote Service";

  private constructor() {
    super(); // Call BaseService constructor without arguments
  }

  public static getInstance(): VoteService {
    if (!VoteService.instance) {
      VoteService.instance = new VoteService();
    }
    return VoteService.instance;
  }

  // Implement the required methods from BaseService
  public async start(): Promise<void> {
    console.log(`[${this.serviceName}] Started`);
  }

  public async stop(): Promise<void> {
    console.log(`[${this.serviceName}] Stopped`);
  }

  /**
   * Submit a vote on-chain for a nominee
   */
  public async submitVoteOnChain(
    nomineeVotes: NomineeVote[],
    smartAccountAddress: string,
    accessToken: string
  ): Promise<VoteResult> {
    try {
      console.log(
        `[${this.serviceName}] Starting on-chain vote submission for ${smartAccountAddress}`
      );
      console.log(
        `[${this.serviceName}] Nominee votes:`,
        JSON.stringify(nomineeVotes, null, 2)
      );

      // Validate inputs
      if (!nomineeVotes || nomineeVotes.length === 0) {
        console.error(`[${this.serviceName}] No nominee votes provided`);
        return {
          success: false,
          error: "No nominee votes provided",
        };
      }

      if (!smartAccountAddress) {
        console.error(
          `[${this.serviceName}] No smart account address provided`
        );
        return {
          success: false,
          error: "No smart account address provided",
        };
      }

      if (!accessToken) {
        console.error(`[${this.serviceName}] No access token provided`);
        return {
          success: false,
          error: "No access token provided",
        };
      }

      // Create an Axios client for API requests
      const baseUrl =
        process.env.COLLABLAND_API_URL ||
        "https://api-qa.collab.land/accountkit/v1";
      console.log(`[${this.serviceName}] Using Collabland API URL: ${baseUrl}`);

      const client = axios.create({
        baseURL: baseUrl,
        headers: {
          "X-API-KEY": process.env.COLLABLAND_API_KEY || "",
          "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN || "",
          "Content-Type": "application/json",
        },
        timeout: 5 * 60 * 1000,
      });

      console.log(
        `[${this.serviceName}] API Key present:`,
        !!process.env.COLLABLAND_API_KEY
      );
      console.log(
        `[${this.serviceName}] Telegram Bot Token present:`,
        !!process.env.TELEGRAM_BOT_TOKEN
      );

      // Extract nominee IDs and vote counts
      const nomineeIds = nomineeVotes.map((vote) => vote.nominee_id);
      const voteCounts = nomineeVotes.map((vote) => vote.vote_count);

      console.log(
        `[${this.serviceName}] Using voting token contract: ${VOTE_TOKEN_ADDRESS}`
      );
      console.log(
        `[${this.serviceName}] Using voting contract: ${VOTING_CONTRACT_ADDRESS}`
      );

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
      console.log(`[${this.serviceName}] Total vote count: ${totalVoteCounts}`);

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

      console.log(
        `[${this.serviceName}] Submitting vote UserOperation payload:`,
        JSON.stringify(payload, null, 2)
      );

      const v2ApiUrl = baseUrl.replace("v1", "v2");
      console.log(`[${this.serviceName}] Using V2 API URL: ${v2ApiUrl}`);

      const requestUrl = `${v2ApiUrl}/platform/evm/submitUserOperation?chainId=84532&platform=twitter`;
      console.log(`[${this.serviceName}] Full request URL: ${requestUrl}`);

      const requestHeaders = {
        "X-ACCESS-TOKEN": accessToken,
        "X-API-KEY": process.env.COLLABLAND_API_KEY || "",
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      console.log(
        `[${this.serviceName}] Request headers:`,
        JSON.stringify(requestHeaders, null, 2)
      );

      // Added retry logic for submitting user operation
      let userOpHash = null;
    //   let userOpData = null;
      let submissionRetries = 0;
      const maxSubmissionRetries = 3;
      const retryDelay = 3000; // 3 seconds between retries

      console.log(
        `[${this.serviceName}] Starting submission with up to ${maxSubmissionRetries} retries`
      );

      while (submissionRetries < maxSubmissionRetries) {
        try {
          console.log(
            `[${this.serviceName}] Attempt ${submissionRetries + 1}/${maxSubmissionRetries} to submit UserOperation`
          );

          // Submit the user operation to execute the vote
          const { data } = await client.post(requestUrl, payload, {
            headers: requestHeaders,
          });

          console.log(
            `[${this.serviceName}] User operation response:`,
            JSON.stringify(data, null, 2)
          );

        //   userOpData = data;
          userOpHash = data.userOperationHash;

          if (userOpHash) {
            console.log(
              `[${this.serviceName}] UserOperation submitted successfully with hash:`,
              userOpHash
            );
            break;
          } else {
            console.warn(
              `[${this.serviceName}] UserOperation hash not received (attempt ${submissionRetries + 1}/${maxSubmissionRetries})`
            );
          }
        } catch (err) {
          if (axios.isAxiosError(err)) {
            console.error(
              `[${this.serviceName}] Axios error submitting UserOperation (attempt ${submissionRetries + 1}/${maxSubmissionRetries}):`,
              {
                status: err.response?.status,
                statusText: err.response?.statusText,
                data: err.response?.data,
                message: err.message,
              }
            );
          } else {
            console.error(
              `[${this.serviceName}] Unknown error submitting UserOperation (attempt ${submissionRetries + 1}/${maxSubmissionRetries}):`,
              err
            );
          }
        }

        submissionRetries++;
        console.log(
          `[${this.serviceName}] Retrying submission in ${retryDelay / 1000} seconds... (${submissionRetries}/${maxSubmissionRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }

      if (!userOpHash) {
        console.error(
          `[${this.serviceName}] Failed to submit UserOperation after ${maxSubmissionRetries} attempts`
        );
        return {
          success: false,
          error: "Failed to submit vote operation after multiple attempts",
        };
      }

      console.log(
        `[${this.serviceName}] UserOperation submitted with hash: ${userOpHash}`
      );

      // Wait for the user operation to complete
      let receipt = null;
      let receiptRetries = 0;
      const maxReceiptRetries = 2;
      const receiptRetryDelay = 5000; // 5 seconds between receipt checks

      console.log(
        `[${this.serviceName}] Now checking for receipt with up to ${maxReceiptRetries} attempts`
      );

      while (receiptRetries < maxReceiptRetries) {
        try {
          const receiptUrl = `/telegrambot/evm/userOperationReceipt?chainId=84532&userOperationHash=${userOpHash}`;
          console.log(
            `[${this.serviceName}] Fetching receipt (attempt ${receiptRetries + 1}/${maxReceiptRetries}): ${receiptUrl}`
          );

          const receiptResponse = await client.get(receiptUrl);

          receipt = receiptResponse.data;
          console.log(
            `[${this.serviceName}] Receipt data:`,
            JSON.stringify(receipt, null, 2)
          );

          if (receipt && receipt.success) {
            console.log(
              `[${this.serviceName}] Receipt successful with transaction hash:`,
              receipt.receipt?.transactionHash
            );
            break;
          } else {
            console.warn(
              `[${this.serviceName}] Receipt not ready or unsuccessful (attempt ${receiptRetries + 1}/${maxReceiptRetries})`
            );
          }
        } catch (err) {
          if (axios.isAxiosError(err)) {
            console.error(
              `[${this.serviceName}] Axios error fetching receipt (attempt ${receiptRetries + 1}/${maxReceiptRetries}):`,
              {
                status: err.response?.status,
                statusText: err.response?.statusText,
                data: err.response?.data,
                message: err.message,
              }
            );
          } else {
            console.error(
              `[${this.serviceName}] Unknown error fetching receipt (attempt ${receiptRetries + 1}/${maxReceiptRetries}):`,
              err
            );
          }
        }

        receiptRetries++;
        console.log(
          `[${this.serviceName}] Waiting ${receiptRetryDelay / 1000} seconds before next receipt check...`
        );
        await new Promise((resolve) => setTimeout(resolve, receiptRetryDelay)); // Wait 5 seconds between receipt checks
      }

      if (!receipt || !receipt.success) {
        console.error(
          `[${this.serviceName}] Failed to submit votes. Operation timed out or failed after ${maxReceiptRetries} attempts.`
        );
        return {
          success: false,
          error: "Failed to confirm vote submission on the blockchain",
        };
      }

      console.log(
        `[${this.serviceName}] Vote submitted successfully with transaction hash:`,
        receipt.receipt?.transactionHash
      );
      return {
        success: true,
        txHash: receipt.receipt?.transactionHash,
      };
    } catch (error) {
      console.error(
        `[${this.serviceName}] Unexpected error in submitVoteOnChain:`,
        error
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error submitting vote",
      };
    }
  }
}
