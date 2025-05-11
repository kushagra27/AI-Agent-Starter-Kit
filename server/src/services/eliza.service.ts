import { BaseService } from "./base.service.js";
import {
  AgentRuntime,
  Character,
  defaultCharacter,
  ModelProviderName,
  elizaLogger,
  MemoryManager,
} from "@ai16z/eliza";

elizaLogger.closeByNewLine = false;
elizaLogger.verbose = true;

import { SqliteDatabaseAdapter } from "@ai16z/adapter-sqlite";
import Database from "better-sqlite3";
import path from "path";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { gateDataPlugin } from "../plugins/gated-storage-plugin/index.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

import { composeContext } from "@ai16z/eliza";
import { getEmbeddingZeroVector } from "@ai16z/eliza";
import {
  Content,
  HandlerCallback,
  IAgentRuntime,
  IImageDescriptionService,
  Memory,
  ModelClass,
  State,
  UUID,
  CacheManager,
  MemoryCacheAdapter,
} from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";

import { generateMessageResponse, generateShouldRespond } from "@ai16z/eliza";
import { messageCompletionFooter, shouldRespondFooter } from "@ai16z/eliza";
import { Message } from "grammy/types";
import { Bot, Context } from "grammy";
import { bootstrapPlugin } from "@ai16z/plugin-bootstrap";
import { collablandPlugin } from "../plugins/collabland.plugin.js";
import { StorageService } from "../plugins/gated-storage-plugin/services/storage.service.js";

const MAX_MESSAGE_LENGTH = 4096; // Telegram's max message length

const telegramShouldRespondTemplate =
  `# About {{agentName}}:
{{bio}}

# RESPONSE EXAMPLES
{{user1}}: I just saw a really great movie
{{user2}}: Oh? Which movie?
Result: [IGNORE]

{{agentName}}: Oh, this is my favorite scene
{{user1}}: sick
{{user2}}: wait, why is it your favorite scene
Result: [RESPOND]

{{user1}}: stfu bot
Result: [STOP]

{{user1}}: Hey {{agent}}, can you help me with something
Result: [RESPOND]

{{user1}}: {{agentName}} stfu plz
Result: [STOP]

{{user1}}: i need help
{{agentName}}: how can I help you?
{{user1}}: no. i need help from someone else
Result: [IGNORE]

{{user1}}: Hey {{agent}}, can I ask you a question
{{agentName}}: Sure, what is it
{{user1}}: can you ask claude to create a basic react module that demonstrates a counter
Result: [RESPOND]

{{user1}}: {{agentName}} can you tell me a story
{{agentName}}: uhhh...
{{user1}}: please do it
{{agentName}}: okay
{{agentName}}: once upon a time, in a quaint little village, there was a curious girl named elara
{{user1}}: I'm loving it, keep going
Result: [RESPOND]

{{user1}}: {{agentName}} stop responding plz
Result: [STOP]

{{user1}}: okay, i want to test something. {{agentName}}, can you say marco?
{{agentName}}: marco
{{user1}}: great. okay, now do it again
Result: [RESPOND]

Response options are [RESPOND], [IGNORE] and [STOP].

{{agentName}} is in a room with other users and should only respond when they are being addressed, and should not respond if they are continuing a conversation that is very long.

Respond with [RESPOND] to messages that are directed at {{agentName}}, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting, relevant, or does not directly address {{agentName}}, respond with [IGNORE]

Also, respond with [IGNORE] to messages that are very short or do not contain much information.

If a user asks {{agentName}} to be quiet, respond with [STOP]
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, respond with [STOP]

IMPORTANT: {{agentName}} is particularly sensitive about being annoying, so if there is any doubt, it is better to respond with [IGNORE].
If {{agentName}} is conversing with a user and they have not asked to stop, it is better to respond with [RESPOND].

The goal is to decide whether {{agentName}} should respond to the last message.

{{recentMessages}}

Thread of Tweets You Are Replying To:

{{formattedConversation}}

# INSTRUCTIONS: Choose the option that best describes {{agentName}}'s response to the last message. Ignore messages if they are addressed to someone else.
` + shouldRespondFooter;

const telegramMessageHandlerTemplate =
  // {{goals}}
  `# Action Names
{{actionNames}}

# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

Examples of {{agentName}}'s dialog and actions:
{{messageExamples}}

{{providers}}

{{attachments}}

{{actions}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

# Task: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:
Current Post:
{{currentPost}}
Thread of Tweets You Are Replying To:

{{formattedConversation}}
` + messageCompletionFooter;

interface ParsedEventQuery {
  location: string;
  time: string;
  date_range_start: string;
  date_range_end: string;
  time_of_day: string;
  time_range_start: string; // 24-hour format HH:mm
  time_range_end: string; // 24-hour format HH:mm
  event_type: string;
  category: string;
  subcategory: string;
  attendees: number | null;
  accessibility: string;
  keywords: string[];
  preferences: string[];
  exclusions: string[];
  format: "in-person" | "online" | "hybrid";
  duration: string;
  language: string;
  original_query: string;
}

export class MessageManager {
  public bot: Bot<Context>;
  private runtime: IAgentRuntime;
  private imageService: IImageDescriptionService;

  constructor(bot: Bot<Context>, runtime: IAgentRuntime) {
    this.bot = bot;
    this.runtime = runtime;
  }

  // Process image messages and generate descriptions
  private async processImage(
    message: Message
  ): Promise<{ description: string } | null> {
    // elizaLogger.info(
    //     "🖼️ Processing image message:",
    //     JSON.stringify(message, null, 2)
    // );

    try {
      let imageUrl: string | null = null;

      // Handle photo messages
      if ("photo" in message && message.photo!.length > 0) {
        const photo = message.photo![message.photo!.length - 1];
        const fileLink = await this.bot.api.getFile(photo.file_id);
        imageUrl = fileLink.toString();
      }
      // Handle image documents
      else if (
        "document" in message &&
        message.document?.mime_type?.startsWith("image/")
      ) {
        const doc = message.document;
        const fileLink = await this.bot.api.getFile(doc.file_id);
        imageUrl = fileLink.toString();
      }

      if (imageUrl) {
        const { title, description } =
          await this.imageService.describeImage(imageUrl);
        const fullDescription = `[Image: ${title}\n${description}]`;
        return { description: fullDescription };
      }
    } catch (error) {
      console.error("❌ Error processing image:", error);
    }

    return null; // No image found
  }

  // Decide if the bot should respond to the message
  private async _shouldRespond(
    message: Message,
    state: State
  ): Promise<boolean> {
    // Respond if bot is mentioned

    if (
      "text" in message &&
      message.text?.includes(`@${this.bot.botInfo?.username}`)
    ) {
      return true;
    }

    // Respond to private chats
    if (message.chat.type === "private") {
      return true;
    }

    // Respond to images in group chats
    if (
      "photo" in message ||
      ("document" in message &&
        message.document?.mime_type?.startsWith("image/"))
    ) {
      return false;
    }

    // Use AI to decide for text or captions
    if ("text" in message || ("caption" in message && message.caption)) {
      const shouldRespondContext = composeContext({
        state,
        template:
          this.runtime.character.templates?.telegramShouldRespondTemplate ||
          this.runtime.character?.templates?.shouldRespondTemplate ||
          telegramShouldRespondTemplate,
      });

      const response = await generateShouldRespond({
        runtime: this.runtime,
        context: shouldRespondContext,
        modelClass: ModelClass.MEDIUM,
      });

      return response === "RESPOND";
    }

    return false; // No criteria met
  }

  // Send long messages in chunks
  private async sendMessageInChunks(
    ctx: Context,
    content: string,
    replyToMessageId?: number
  ): Promise<Message.TextMessage[]> {
    const chunks = this.splitMessage(content);
    const sentMessages: Message.TextMessage[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const sentMessage = (await this.bot.api.sendMessage(ctx.chat!.id, chunk, {
        reply_parameters:
          i === 0 && replyToMessageId
            ? { message_id: replyToMessageId }
            : undefined,
      })) as Message.TextMessage;

      sentMessages.push(sentMessage);
    }

    return sentMessages;
  }

  // Split message into smaller parts
  private splitMessage(text: string): string[] {
    const chunks: string[] = [];
    let currentChunk = "";

    const lines = text.split("\n");
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 <= MAX_MESSAGE_LENGTH) {
        currentChunk += (currentChunk ? "\n" : "") + line;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = line;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  // Generate a response using AI
  private async _generateResponse(
    message: Memory,
    _state: State,
    context: string
  ): Promise<Content | null> {
    const { userId, roomId } = message;
    elizaLogger.debug("[_generateResponse] check1");
    const response = await generateMessageResponse({
      runtime: this.runtime,
      context,
      modelClass: ModelClass.MEDIUM,
    });
    elizaLogger.debug("[_generateResponse] check2");
    if (!response) {
      console.error("❌ No response from generateMessageResponse");
      return null;
    }
    elizaLogger.debug("[_generateResponse] check3");
    // store the response in the database

    await this.runtime.databaseAdapter.log({
      body: { message, context, response },
      userId: userId,
      roomId,
      type: "response",
    });
    elizaLogger.debug("[_generateResponse] check4");
    return response;
  }

  /**
   * Handles a custom message and generates a response using the LLM
   * @param message Custom message to process
   * @param options Optional configuration for message handling
   * @returns Promise<Content | null> The generated response
   */
  public async handleCustomMessage(
    message: {
      text: string;
      source: string;
    },
    options: {
      userId?: string;
      userName?: string;
      roomId?: string;
      messageId?: string;
      template?: string;
    } = {}
  ): Promise<Content | null> {
    try {
      // Generate or use provided IDs
      const userId = stringToUuid(options.userId || "system");
      const userName = options.userName || "System";
      const roomId = stringToUuid(options.roomId || "custom-room");
      const messageId = stringToUuid(
        options.messageId || `custom-${Date.now()}`
      );
      const agentId = this.runtime.agentId;

      // Ensure connection exists
      await this.runtime.ensureConnection(
        userId,
        roomId,
        userName,
        userName,
        message.source
      );

      // Create content object
      const content: Content = {
        text: message.text,
        source: message.source,
      };

      // Create and store memory
      const memory = await this.runtime.messageManager.addEmbeddingToMemory({
        id: messageId,
        agentId,
        userId,
        roomId,
        content,
        createdAt: Date.now(),
      });

      await this.runtime.messageManager.createMemory(memory, true);

      // Update state with the new memory
      let state = await this.runtime.composeState(memory);
      state = await this.runtime.updateRecentMessageState(state);

      // Generate context using provided template or default
      const context = composeContext({
        state,
        template: options.template || telegramMessageHandlerTemplate,
      });

      // Generate response
      const response = await this._generateResponse(memory, state, context);

      console.log("response", response);

      if (response) {
        // Update state after response
        state = await this.runtime.updateRecentMessageState(state);

        // Process any resulting actions
        // const responseMemory: Memory = {
        //   id: stringToUuid(`response-${Date.now()}`),
        //   agentId,
        //   userId,
        //   roomId,
        //   content: response,
        //   createdAt: Date.now(),
        // };

        // await this.runtime.processActions(memory, [responseMemory], state);
      }

      return response;
    } catch (error) {
      elizaLogger.error("[handleCustomMessage] Error:", error);
      throw error;
    }
  }

  // Main handler for incoming messages
  public async handleMessage(ctx: Context): Promise<void> {
    if (!ctx.message || !ctx.from) {
      return; // Exit if no message or sender info
    }

    if (
      this.runtime.character.clientConfig?.telegram?.shouldIgnoreBotMessages &&
      ctx.from.is_bot
    ) {
      return;
    }
    if (
      this.runtime.character.clientConfig?.telegram
        ?.shouldIgnoreDirectMessages &&
      ctx.chat?.type === "private"
    ) {
      return;
    }

    const message = ctx.message;

    try {
      // Convert IDs to UUIDs
      const userId = stringToUuid(ctx.from.id.toString()) as UUID;
      const userName =
        ctx.from.username || ctx.from.first_name || "Unknown User";
      const chatId = stringToUuid(
        ctx.chat?.id.toString() + "-" + this.runtime.agentId
      ) as UUID;
      const agentId = this.runtime.agentId;
      const roomId = chatId;

      await this.runtime.ensureConnection(
        userId,
        roomId,
        userName,
        userName,
        "telegram"
      );

      const messageId = stringToUuid(
        message.message_id.toString() + "-" + this.runtime.agentId
      ) as UUID;

      // Handle images
      const imageInfo = await this.processImage(message);

      // Get text or caption
      let messageText = "";
      if ("text" in message) {
        messageText = ctx.match as string;
      } else if ("caption" in message && message.caption) {
        messageText = message.caption;
      }

      // Combine text and image description
      const fullText = imageInfo
        ? `${messageText} ${imageInfo.description}`
        : messageText;

      if (!fullText) {
        return; // Skip if no content
      }

      const content: Content = {
        text: fullText,
        source: "telegram",
        inReplyTo:
          "reply_to_message" in message && message.reply_to_message
            ? stringToUuid(
                message.reply_to_message.message_id.toString() +
                  "-" +
                  this.runtime.agentId
              )
            : undefined,
      };

      // Create memory for the message

      const memory = await this.runtime.messageManager.addEmbeddingToMemory({
        id: messageId,
        agentId,
        userId,
        roomId,
        content,
        createdAt: message.date * 1000,
      });
      // set unique to avoid duplicating memories
      await this.runtime.messageManager.createMemory(memory, true);
      // Update state with the new memory
      let state = await this.runtime.composeState(memory);
      state = await this.runtime.updateRecentMessageState(state);
      // Decide whether to respond
      const shouldRespond = await this._shouldRespond(message, state);

      if (shouldRespond) {
        const context = composeContext({
          state,
          template:
            this.runtime.character.templates?.telegramMessageHandlerTemplate ||
            this.runtime.character?.templates?.messageHandlerTemplate ||
            telegramMessageHandlerTemplate,
        });
        elizaLogger.debug(
          "[handleMessage] context",
          JSON.stringify(context, null, 2)
        );
        const responseContent = await this._generateResponse(
          memory,
          state,
          context
        );

        if (!responseContent || !responseContent.text) return;

        // Send response in chunks
        const callback: HandlerCallback = async (content: Content) => {
          const sentMessages = await this.sendMessageInChunks(
            ctx,
            content.text,
            message.message_id
          );

          const memories: Memory[] = [];

          // Create memories for each sent message
          for (let i = 0; i < sentMessages.length; i++) {
            const sentMessage = sentMessages[i];
            const isLastMessage = i === sentMessages.length - 1;

            const memory: Memory = {
              id: stringToUuid(
                sentMessage.message_id.toString() + "-" + this.runtime.agentId
              ),
              agentId,
              userId,
              roomId,
              content: {
                ...content,
                text: sentMessage.text,
                inReplyTo: messageId,
              },
              createdAt: sentMessage.date * 1000,
              embedding: getEmbeddingZeroVector(),
            };
            elizaLogger.info(
              `[eliza.service] memory action ${memory.content.action}`
            );

            // Set action to CONTINUE for all messages except the last one
            // For the last message, use the original action from the response content
            memory.content.action = !isLastMessage ? "IGNORE" : content.action;

            await this.runtime.messageManager.createMemory(memory);
            memories.push(memory);
          }

          return memories;
        };

        // Execute callback to send messages and log memories
        const responseMessages = await callback(responseContent);

        // Update state after response
        state = await this.runtime.updateRecentMessageState(state);

        elizaLogger.debug("[eliza.service] processing resulting actions");
        await this.runtime.processActions(
          memory,
          responseMessages,
          state,
          callback
        );

        elizaLogger.debug("[eliza.service] evaluating");
        const data = await this.runtime.evaluate(memory, state, shouldRespond);
        elizaLogger.debug(`[eliza.service] evaluated ${data}`);
      }
    } catch (error) {
      console.error("❌ Error handling message:", error);
      console.error("Error sending message:", error);
    }
  }
}

export class ElizaService extends BaseService {
  private static instance: ElizaService;
  private runtime: AgentRuntime;
  public messageManager: MessageManager;
  private bot: Bot<Context>;

  private constructor(bot: Bot<Context>) {
    super();

    // Load character from json file
    let character: Character;

    if (!process.env.ELIZA_CHARACTER_PATH) {
      elizaLogger.info(
        "No ELIZA_CHARACTER_PATH defined, using default character"
      );
      character = defaultCharacter;
    } else {
      try {
        // Use absolute path from project root
        const fullPath = resolve(
          __dirname,
          "../../..",
          process.env.ELIZA_CHARACTER_PATH
        );
        elizaLogger.info(`Loading character from: ${fullPath}`);

        if (!existsSync(fullPath)) {
          throw new Error(`Character file not found at ${fullPath}`);
        }

        const fileContent = readFileSync(fullPath, "utf-8");
        character = JSON.parse(fileContent);
        elizaLogger.info(
          "Successfully loaded custom character:",
          character.name
        );
      } catch (error) {
        console.error(
          `Failed to load character from ${process.env.ELIZA_CHARACTER_PATH}:`,
          error
        );
        elizaLogger.info("Falling back to default character");
        character = defaultCharacter;
      }
    }

    // character.modelProvider = ModelProviderName.GAIANET // FIX: Commented out since model provider is best set from character.json

    const sqlitePath = path.join(__dirname, "..", "..", "..", "eliza.sqlite");
    elizaLogger.info("Using SQLite database at:", sqlitePath);
    // Initialize SQLite adapter
    const db = new SqliteDatabaseAdapter(new Database(sqlitePath));

    db.init()
      .then(() => {
        elizaLogger.info("Database initialized.");
      })
      .catch((error) => {
        console.error("Failed to initialize database:", error);
        throw error;
      });

    try {
      this.runtime = new AgentRuntime({
        databaseAdapter: db,
        token: process.env.OPENAI_API_KEY || "",
        modelProvider: character.modelProvider || ModelProviderName.OPENAI,
        character,
        conversationLength: 4096,
        plugins: [bootstrapPlugin, collablandPlugin, gateDataPlugin],
        cacheManager: new CacheManager(new MemoryCacheAdapter()),
        logging: true,
      });
      // Create memory manager
      const onChainMemory = new MemoryManager({
        tableName: "onchain",
        runtime: this.runtime,
      });
      this.runtime.registerMemoryManager(onChainMemory);
      this.messageManager = new MessageManager(bot, this.runtime);
      this.bot = bot;
    } catch (error) {
      console.error("Failed to initialize Eliza runtime:", error);
      throw error;
    }
  }

  public static getInstance(bot: Bot<Context>): ElizaService {
    if (!ElizaService.instance) {
      ElizaService.instance = new ElizaService(bot);
    }
    return ElizaService.instance;
  }

  public async start(): Promise<void> {
    try {
      // make sure this gets initialized before anything tries to use it in the plugin.
      // not sure where this should actually be hooked up
      await StorageService.getInstance().start();
    } catch (err) {
      elizaLogger.warn("[eliza] gated storage service is unavailable");
    }
    try {
      //register AI based command handlers here
      this.bot.command("eliza", (ctx) =>
        this.messageManager.handleMessage(ctx)
      );
      elizaLogger.info("Eliza service started successfully");
    } catch (error) {
      console.error("Failed to start Eliza service:", error);
      throw error;
    }
  }

  public getRuntime(): AgentRuntime {
    return this.runtime;
  }

  public async stop(): Promise<void> {
    try {
      elizaLogger.info("Eliza service stopped");
    } catch (error) {
      console.error("Error stopping Eliza service:", error);
    }
  }

  /**
   * Parses an event search query using the AI agent to extract structured information
   * @param query The raw search query from user
   * @returns Parsed query with location and time information
   */
  public async parseEventQuery(
    query: string,
    messageTimestamp: Date
  ): Promise<ParsedEventQuery> {
    try {
      const response = await this.messageManager.handleCustomMessage(
        {
          text: query,
          source: "event-parser",
        },
        {
          userId: "event-parser",
          roomId: "event-parsing",
          template: `# Task: Parse Event Search Query

You are an AI assistant specializing in parsing natural language event queries into structured data. Your task is to extract detailed event search parameters from user queries, no matter how they are phrased.

Message Time: ${messageTimestamp.toString()}
Local Time: ${messageTimestamp.toLocaleTimeString()}
UTC Time: ${messageTimestamp.toUTCString()}
Timezone Offset: ${messageTimestamp.getTimezoneOffset() / -60}
Query to parse: "${query}"

Instructions:
1. Extract ALL possible event-related information from the query
2. Return a flat JSON object (avoid nested structures)
3. Include ONLY the extracted data, no explanations
4. Use consistent date and time formats
5. Calculate all relative times from the message timestamp above, respecting timezone
6. Maintain all fields in every response

Time Processing Rules:
- Use message timestamp as reference point for all relative times
- Account for timezone offset in all calculations
- "now" = message timestamp + 30 mins
- "today" = calendar date of message in local timezone
- "tomorrow" = message date + 1 day in local timezone
- "this weekend" = next Saturday and Sunday from message date
- "next week" = 7 days from message date
- If no specific time mentioned:
  * For today: 
    - If message time < 17:00: Use next round hour from message time
    - If message time >= 17:00: Use 19:00-22:00
  * For future dates: Use 09:00-18:00
  * For immediate events: Round message time + 30 mins to next 30 min interval
- Round start times to next 30-minute interval from message time
- Ensure minimum 30 mins buffer from message time
- Duration defaults:
  * Classes/Workshops: 1 hour
  * Concerts/Shows: 2-3 hours
  * Meetups: 1-2 hours
  * Conferences: Full day

Example Queries and Their Parsed Results:

Query 1: "Find events now" (Message Time: Tue Feb 25 2025 19:03:28 GMT+0400)
{
  "location": "local",
  "time": "now",
  "date_range_start": "2025-02-25",
  "date_range_end": "2025-02-25",
  "time_of_day": "evening",
  "time_range_start": "19:30",
  "time_range_end": "20:30",
  "event_type": "general",
  "category": "",
  "subcategory": "",
  "attendees": null,
  "accessibility": "",
  "keywords": ["immediate"],
  "preferences": ["immediate start"],
  "exclusions": [],
  "format": "in-person",
  "duration": "1 hour",
  "language": "english",
  "original_query": "Find events now"
}

Query 2: "Anything happening today" (Message Time: Tue Feb 25 2025 19:03:28 GMT+0400)
{
  "location": "local",
  "time": "today evening",
  "date_range_start": "2025-02-25",
  "date_range_end": "2025-02-25",
  "time_of_day": "evening",
  "time_range_start": "19:30",
  "time_range_end": "22:00",
  "event_type": "general",
  "category": "",
  "subcategory": "",
  "attendees": null,
  "accessibility": "",
  "keywords": ["today", "evening"],
  "preferences": ["evening events"],
  "exclusions": [],
  "format": "in-person",
  "duration": "",
  "language": "english",
  "original_query": "Anything happening today"
}

Query 3: "near downtown denver today for ai" (Message Time: Tue Feb 25 2025 19:03:28 GMT+0400)
{
  "location": "downtown denver",
  "time": "today evening",
  "date_range_start": "2025-02-25",
  "date_range_end": "2025-02-25",
  "time_of_day": "evening",
  "time_range_start": "19:30",
  "time_range_end": "21:30",
  "event_type": "meetup",
  "category": "technology",
  "subcategory": "artificial intelligence",
  "attendees": null,
  "accessibility": "",
  "keywords": ["ai", "technology", "denver"],
  "preferences": ["evening events"],
  "exclusions": [],
  "format": "in-person",
  "duration": "2 hours",
  "language": "english",
  "original_query": "near downtown denver today for ai"
}

Remember:
- Keep the JSON structure flat (no nested objects)
- Use null for unknown numeric values
- Use empty strings for unknown text values
- Use empty arrays [] for unknown array values
- Use consistent date formats (YYYY-MM-DD)
- Use 24-hour time format (HH:mm)
- All times must be relative to the message timestamp
- Account for timezone offset in all calculations
- Round times to next 30-minute interval
- Ensure minimum 30 mins buffer from message time
- Use lowercase for all string values except proper nouns

Parse the query now:`,
        }
      );

      console.log(response);

      if (!response?.location) {
        throw new Error("Failed to parse event query");
      }

      // Clean up the response to extract just the JSON
      // const cleanedResponse = response.text
      //   // Remove any markdown code block markers
      //   .replace(/```json\s*|\s*```/g, "")
      //   // Remove any leading/trailing whitespace
      //   .trim();

      // elizaLogger.debug("[parseEventQuery] Cleaned response:", cleanedResponse);

      const parsed = JSON.parse(JSON.stringify(response)) as ParsedEventQuery;

      // Validate and provide defaults for required fields
      const messageTime = messageTimestamp || new Date();

      // Helper function to round to next 30 minutes
      const roundToNext30Minutes = (date: Date) => {
        const minutes = date.getMinutes();
        const roundedMinutes = Math.ceil(minutes / 30) * 30;
        const result = new Date(date);
        result.setMinutes(roundedMinutes);
        result.setSeconds(0);
        result.setMilliseconds(0);
        if (roundedMinutes === 60) {
          result.setHours(result.getHours() + 1);
          result.setMinutes(0);
        }
        return result;
      };

      // Calculate default start and end times
      const defaultStartTime = roundToNext30Minutes(
        new Date(messageTime.getTime() + 30 * 60000)
      );

      const defaultEndTime = new Date(defaultStartTime.getTime() + 60 * 60000);

      // Helper function to format time in HH:mm
      const formatTime = (date: Date) => {
        return date.toTimeString().slice(0, 5);
      };

      // Determine time of day based on message hour
      const getTimeOfDay = (hour: number) => {
        if (hour < 12) return "morning";
        if (hour < 17) return "afternoon";
        if (hour < 21) return "evening";
        return "night";
      };

      const validatedQuery: ParsedEventQuery = {
        location: parsed.location || "local",
        time: parsed.time || "today",
        date_range_start:
          parsed.date_range_start || messageTime.toISOString().split("T")[0],
        date_range_end:
          parsed.date_range_end || messageTime.toISOString().split("T")[0],
        time_of_day: parsed.time_of_day || getTimeOfDay(messageTime.getHours()),
        time_range_start:
          parsed.time_range_start || formatTime(defaultStartTime),
        time_range_end: parsed.time_range_end || formatTime(defaultEndTime),
        event_type: parsed.event_type || "general",
        category: parsed.category || "",
        subcategory: parsed.subcategory || "",
        attendees: parsed.attendees || null,
        accessibility: parsed.accessibility || "",
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        preferences: Array.isArray(parsed.preferences)
          ? parsed.preferences
          : [],
        exclusions: Array.isArray(parsed.exclusions) ? parsed.exclusions : [],
        format: parsed.format || "in-person",
        duration: parsed.duration || "",
        language: parsed.language || "english",
        original_query: query,
      };

      elizaLogger.debug("[parseEventQuery] Validated query:", validatedQuery);
      return validatedQuery;
    } catch (error) {
      elizaLogger.error("[parseEventQuery] Error:", error);
      throw error;
    }
  }
}
