const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const path = require('path');
const fs = require('fs');

// Constants for spam detection
const SPAM_THRESHOLD = config.spam.threshold;
const TIME_WINDOW = config.spam.timeWindow;
const SIMILARITY_THRESHOLD = config.spam.similarityThreshold;
const FILTERED_CHANNELS = config.spam.exceptions;

// In-memory message store using Map
const USER_MESSAGES = new Map();

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
        for (const ID of FILTERED_CHANNELS) {
            if (message.channel.id === ID) return;
        }
        if (message.author.bot || message.member.roles.cache.has(config.staffRoleId)) return;

        const CURRENT_TIME = Date.now();
        const USER_ID = message.author.id;

        // Get or initialize user's message array
        if (!USER_MESSAGES.has(USER_ID)) {
            USER_MESSAGES.set(USER_ID, []);
        }

        // Clean up old messages and add new one
        const messages = USER_MESSAGES.get(USER_ID)
            .filter(msg => CURRENT_TIME - msg.timestamp < TIME_WINDOW);

        messages.push({
            timestamp: CURRENT_TIME,
            content: message.content
        });

        USER_MESSAGES.set(USER_ID, messages);

        // Check for spam
        if (messages.length >= SPAM_THRESHOLD) {
            // Quick similarity check
            const uniqueMessages = new Set(messages.map(msg => msg.content));
            if (uniqueMessages.size / messages.length <= SIMILARITY_THRESHOLD) {
                try {
                    // Immediate timeout
                    await message.member.timeout(config.timeoutDuration, 'Spam Detection');

                    // Run cleanup operations in parallel
                    await Promise.all([
                        // Delete messages
                        (async () => {
                            const recentMessages = await message.channel.messages.fetch({
                                limit: Math.min(SPAM_THRESHOLD * 2, 100)
                            });
                            const spamMessages = recentMessages.filter(msg =>
                                msg.author.id === USER_ID &&
                                CURRENT_TIME - msg.createdTimestamp < TIME_WINDOW
                            );
                            await Promise.all(spamMessages.map(msg => msg.delete()));
                        })(),

                        // Notify staff
                        (async () => {
                            const staffChannel = client.channels.cache.get(config.staffChannelId);
                            if (staffChannel) {
                                const embed = new EmbedBuilder()
                                    .setTitle('⚠️ Spam Detection')
                                    .setColor(0xFF0000)
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

                    // Clear user's spam history
                    USER_MESSAGES.delete(USER_ID);

                } catch (error) {
                    console.error('Error handling spam:', error);
                }
            }
        }
    }
};