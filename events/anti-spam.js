// Import necessary modules from discord.js and load configuration
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

// --- Spam Detection Constants ---

// The number of messages a user can send in a short time before triggering spam detection.
const SPAM_THRESHOLD = config.spam.threshold;

// The time frame (in milliseconds) in which messages are counted for spam detection.
const TIME_WINDOW = config.spam.timeWindow;

// The ratio of unique messages to total messages. If below this, it's considered spam.
const SIMILARITY_THRESHOLD = config.spam.similarityThreshold;

// Channels to be exempted from spam checks.
const FILTERED_CHANNELS = config.spam.exceptions;

// In-memory store for tracking recent messages from each user.
const USER_MESSAGES = new Map();

// --- Event Handler ---

module.exports = {
    event: 'messageCreate', // Specifies which event this file handles

    /**
     * Executes when a new message is created.
     * @param {Client} client - The Discord client instance.
     * @param {Message} message - The message that was created.
     */
    async run(client, message) {
        // --- Initial Checks ---

        // Ignore messages in filtered channels
        if (FILTERED_CHANNELS.includes(message.channel.id)) return;

        // Ignore messages from bots or staff members
        if (message.author.bot || message.member.roles.cache.has(config.staffRoleId)) return;

        // --- Message Tracking ---

        const CURRENT_TIME = Date.now();
        const USER_ID = message.author.id;

        // Initialize message history for the user if it doesn't exist
        if (!USER_MESSAGES.has(USER_ID)) {
            USER_MESSAGES.set(USER_ID, []);
        }

        // Get the user's message history and filter out old messages
        const messages = USER_MESSAGES.get(USER_ID)
            .filter(msg => CURRENT_TIME - msg.timestamp < TIME_WINDOW);

        // Add the new message to the user's history
        messages.push({
            timestamp: CURRENT_TIME,
            content: message.content
        });
        USER_MESSAGES.set(USER_ID, messages);

        // --- Spam Detection Logic ---

        // Check if the number of recent messages exceeds the spam threshold
        if (messages.length >= SPAM_THRESHOLD) {
            // Check for message similarity to avoid punishing rapid but unique conversations
            const uniqueMessages = new Set(messages.map(msg => msg.content));
            if (uniqueMessages.size / messages.length <= SIMILARITY_THRESHOLD) {
                try {
                    // --- Actions on Spam Detection ---

                    // Immediately timeout the user
                    await message.member.timeout(config.timeoutDuration, 'Spam Detection');

                    // Perform cleanup and notification tasks concurrently
                    await Promise.all([
                        // Delete the user's recent spam messages
                        (async () => {
                            const recentMessages = await message.channel.messages.fetch({
                                limit: Math.min(SPAM_THRESHOLD * 2, 100) // Fetch a bit more than the threshold
                            });
                            const spamMessages = recentMessages.filter(msg =>
                                msg.author.id === USER_ID &&
                                CURRENT_TIME - msg.createdTimestamp < TIME_WINDOW
                            );
                            await Promise.all(spamMessages.map(msg => msg.delete()));
                        })(),

                        // Notify staff about the action
                        (async () => {
                            const staffChannel = client.channels.cache.get(config.staffChannelId);
                            if (staffChannel) {
                                const embed = new EmbedBuilder()
                                    .setTitle('⚠️ Spam Detection')
                                    .setColor(0xFF0000) // Red color for violations
                                    .setDescription(`User ${message.author.toString()} has been timed out for spamming`)
                                    .addFields(
                                        { name: 'Channel', value: `<#${message.channel.id}>` },
                                        { name: 'Sample Content', value: message.content },
                                        { name: 'Action Taken', value: `Timeout (${config.timeoutDuration / 1000}s)` },
                                        { name: 'Spam Details', value: `${messages.length} messages in ${TIME_WINDOW / 1000}s` }
                                    )
                                    .setTimestamp();

                                await staffChannel.send({ embeds: [embed] });
                            }
                        })()
                    ]);

                    // Clear the user's message history after handling the spam
                    USER_MESSAGES.delete(USER_ID);

                } catch (error) {
                    console.error('Error handling spam:', error);
                }
            }
        }
    }
};
