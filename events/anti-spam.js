const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const path = require('path');
const fs = require('fs');

// Constants for spam detection
const SPAM_THRESHOLD = config.spam.threshold;
const TIME_WINDOW = config.spam.timeWindow;
const SIMILARITY_THRESHOLD = config.spam.similarityThreshold;

// In-memory message store using Map
const userMessages = new Map();

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
        if (message.author.bot || message.member.roles.cache.has(config.staffRoleId)) return;

        const currentTime = Date.now();
        const userId = message.author.id;

        // Get or initialize user's message array
        if (!userMessages.has(userId)) {
            userMessages.set(userId, []);
        }

        // Clean up old messages and add new one
        const messages = userMessages.get(userId)
            .filter(msg => currentTime - msg.timestamp < TIME_WINDOW);

        messages.push({
            timestamp: currentTime,
            content: message.content
        });

        userMessages.set(userId, messages);

        // Check for spam
        if (messages.length >= SPAM_THRESHOLD) {
            // Quick similarity check
            const uniqueMessages = new Set(messages.map(msg => msg.content));
            if (uniqueMessages.size / messages.length <= SIMILARITY_THRESHOLD) {
                try {
                    // Immediate timeout
                    await message.member.timeout(config.timeoutDuration, 'Spam Detection');

                    const spamCase = {
                        type: "spamming",
                        decisionMethod: "Auto",
                        userId: message.author.id,
                        username: message.author.username,
                        channelId: message.channel.id,
                        channelName: message.channel.name,
                        messageContent: message.content,
                        actionTaken: "Timeout",
                        timestamp: new Date().toISOString()
                    };

                    // Run cleanup operations in parallel
                    await Promise.all([
                        // Delete messages
                        (async () => {
                            const recentMessages = await message.channel.messages.fetch({
                                limit: Math.min(SPAM_THRESHOLD * 2, 100)
                            });
                            const spamMessages = recentMessages.filter(msg =>
                                msg.author.id === userId &&
                                currentTime - msg.createdTimestamp < TIME_WINDOW
                            );
                            await Promise.all(spamMessages.map(msg => msg.delete()));
                        })(),

                        // Log case to file
                        (async () => {
                            const casesPath = path.join(__dirname, '..', 'cases.json');
                            const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
                            cases.push(spamCase);
                            fs.writeFileSync(casesPath, JSON.stringify(cases, null, 2));
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
                    userMessages.delete(userId);

                } catch (error) {
                    console.error('Error handling spam:', error);
                }
            }
        }
    }
};