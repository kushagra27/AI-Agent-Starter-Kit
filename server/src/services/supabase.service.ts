import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { BaseService } from "./base.service.js";

interface VoteRecord {
  id: string;
  twitter_username: string;
  smart_account: string;
  token_id: string;
  vote_count: number;
  invite_code: string;
  created_at?: string;
}

interface NomineeVote {
  nominee_id: number;
  vote_count: number;
}

interface VoteWithNominees extends VoteRecord {
  nominee_votes: NomineeVote[];
}

export class SupabaseService extends BaseService {
  private static instance: SupabaseService;
  private supabase: SupabaseClient;

  private constructor() {
    super();
  }

  private async initialize(): Promise<void> {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log("[Supabase] Initializing with URL:", supabaseUrl);
    console.log("[Supabase] Service key present:", !!supabaseServiceKey);

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        "Supabase credentials not found in environment variables. Please check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      );
    }

    try {
      // Use service role key for server-side operations
      this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          headers: {
            "Content-Type": "application/json",
          },
        },
      });

      // Test the connection
      try {
        const { data, error } = await this.supabase
          .from("votes")
          .select("count")
          .limit(1);
        console.log("[Supabase] Connection test data:", data);
        if (error) {
          console.error("[Supabase] Connection test failed:", error);
          throw error;
        }
        console.log("[Supabase] Connection test successful");
      } catch (error: unknown) {
        console.error("[Supabase] Connection test failed:", error);
        throw error;
      }
    } catch (error: unknown) {
      console.error("[Supabase] Failed to initialize client:", error);
      throw error;
    }
  }

  public static async getInstance(): Promise<SupabaseService> {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
      await SupabaseService.instance.initialize();
    }
    return SupabaseService.instance;
  }

  public async start(): Promise<void> {
    // No initialization needed for Supabase client
  }

  public async stop(): Promise<void> {
    // No cleanup needed for Supabase client
  }

  async recordVote(
    twitterUsername: string,
    smartAccount: string,
    tokenId: string,
    voteCount: number,
    inviteCode: string,
    nomineeVotes: NomineeVote[]
  ): Promise<VoteRecord> {
    try {
      console.log("[Supabase] Recording vote for:", {
        twitterUsername,
        smartAccount,
        tokenId,
        voteCount,
        inviteCode,
      });

      // Start a transaction by using a single request
      const { data: voteData, error: voteError } = await this.supabase
        .from("votes")
        .insert({
          twitter_username: twitterUsername,
          smart_account: smartAccount,
          token_id: tokenId,
          vote_count: voteCount,
          invite_code: inviteCode,
        })
        .select()
        .single();

      if (voteError) {
        console.error("[Supabase] Error inserting vote:", voteError);
        throw voteError;
      }

      console.log("[Supabase] Vote record created:", voteData);

      // Insert nominee votes
      const nomineeVotesData = nomineeVotes.map((vote) => ({
        vote_id: voteData.id,
        nominee_id: vote.nominee_id,
        vote_count: vote.vote_count,
      }));

      console.log("[Supabase] Inserting nominee votes:", nomineeVotesData);

      const { error: nomineeError } = await this.supabase
        .from("nominee_votes")
        .insert(nomineeVotesData);

      if (nomineeError) {
        console.error(
          "[Supabase] Error inserting nominee votes:",
          nomineeError
        );
        throw nomineeError;
      }

      console.log("[Supabase] Nominee votes inserted successfully");

      return voteData;
    } catch (error) {
      console.error("[Supabase] Error in recordVote:", error);
      throw error;
    }
  }

  async getVoteByInviteCode(
    inviteCode: string
  ): Promise<VoteWithNominees | null> {
    try {
      const { data, error } = await this.supabase
        .from("votes")
        .select(
          `
          *,
          nominee_votes (
            nominee_id,
            vote_count
          )
        `
        )
        .eq("invite_code", inviteCode)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return null; // No record found
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error("[Supabase] Error fetching vote:", error);
      throw error;
    }
  }

  async getVotesByTokenId(tokenId: string): Promise<VoteWithNominees[]> {
    try {
      const { data, error } = await this.supabase
        .from("votes")
        .select(
          `
          *,
          nominee_votes (
            nominee_id,
            vote_count
          )
        `
        )
        .eq("token_id", tokenId);

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      console.error("[Supabase] Error fetching votes:", error);
      throw error;
    }
  }

  /**
   * Update a vote record with transaction hash
   */
  async updateVoteTransaction(
    voteId: string,
    txHash: string,
    smartAccount?: string
  ): Promise<void> {
    try {
      console.log("[Supabase] Updating vote record with transaction hash:", {
        voteId,
        txHash,
        smartAccount: smartAccount || "unchanged",
      });

      const updateData: {
        transaction_hash: string;
        updated_at: string;
        smart_account?: string;
      } = {
        transaction_hash: txHash,
        updated_at: new Date().toISOString(),
      };

      // If smart account is provided, update it as well
      if (smartAccount) {
        updateData.smart_account = smartAccount;
      }

      const { error } = await this.supabase
        .from("votes")
        .update(updateData)
        .eq("id", voteId);

      if (error) {
        console.error(
          "[Supabase] Error updating vote with transaction hash:",
          error
        );
        throw error;
      }

      console.log("[Supabase] Vote record updated with transaction hash");
    } catch (error) {
      console.error("[Supabase] Error in updateVoteTransaction:", error);
      throw error;
    }
  }

  /**
   * Update smart account for votes that were submitted with a pending smart account
   */
  async updateVoteSmartAccount(
    twitterUsername: string,
    tokenId: string,
    smartAccount: string
  ): Promise<void> {
    try {
      console.log("[Supabase] Updating smart account for votes:", {
        twitterUsername,
        tokenId,
        smartAccount,
      });

      // Find votes with 'pending' smart account for this user and token
      const { data: votes, error: queryError } = await this.supabase
        .from("votes")
        .select("id")
        .eq("twitter_username", twitterUsername)
        .eq("token_id", tokenId)
        .eq("smart_account", "pending");

      if (queryError) {
        console.error(
          "[Supabase] Error finding votes with pending smart account:",
          queryError
        );
        throw queryError;
      }

      if (!votes || votes.length === 0) {
        console.log("[Supabase] No votes found with pending smart account");
        return;
      }

      console.log(
        `[Supabase] Found ${votes.length} votes with pending smart account`
      );

      // Update each vote with the real smart account
      for (const vote of votes) {
        const { error: updateError } = await this.supabase
          .from("votes")
          .update({
            smart_account: smartAccount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", vote.id);

        if (updateError) {
          console.error(
            `[Supabase] Error updating vote ${vote.id} with smart account:`,
            updateError
          );
        } else {
          console.log(
            `[Supabase] Updated vote ${vote.id} with smart account ${smartAccount}`
          );
        }
      }
    } catch (error) {
      console.error("[Supabase] Error in updateVoteSmartAccount:", error);
      throw error;
    }
  }
}
