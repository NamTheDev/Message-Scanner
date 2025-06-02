const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

// Constants for spam detection
const SPAM_THRESHOLD = config.spam.threshold;      // Number of messages to trigger spam detection
const TIME_WINDOW = config.spam.timeWindow;      // Time window in milliseconds (5 seconds)
const SIMILARITY_THRESHOLD = config.spam.similarityThreshold; // Threshold for message similarity (50%)

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
        if (message.author.bot || message.member.roles.cache.has(config.staffRoleId)) return;

        // Load message history
        const messageHistoryPath = path.join(__dirname, '..', 'messageHistory.json');
        let messageHistory = JSON.parse(fs.readFileSync(messageHistoryPath, 'utf8'));

        if (!messageHistory.spam[message.author.id]) {
            messageHistory.spam[message.author.id] = [];
        }

        // Add new message to history
        messageHistory.spam[message.author.id].push({
            timestamp: Date.now(),
            content: message.content
        });

        // Remove messages older than TIME_WINDOW
        const currentTime = Date.now();
        messageHistory.spam[message.author.id] = messageHistory.spam[message.author.id].filter(
            msg => currentTime - msg.timestamp < TIME_WINDOW
        );

        // Save updated history
        fs.writeFileSync(messageHistoryPath, JSON.stringify(messageHistory, null, 2));

        // Check for spam
        const userMessages = messageHistory.spam[message.author.id];
        if (userMessages.length >= SPAM_THRESHOLD) {
            // Check for message similarity
            const uniqueMessages = new Set(userMessages.map(msg => msg.content));
            if (uniqueMessages.size / userMessages.length <= SIMILARITY_THRESHOLD) {
                try {
                    // Get all recent messages from this user in the channel
                    const recentMessages = await message.channel.messages.fetch({ limit: 100 });
                    const userSpamMessages = recentMessages.filter(msg =>
                        msg.author.id === message.author.id &&
                        currentTime - msg.createdTimestamp < TIME_WINDOW
                    );

                    // Delete all spam messages
                    await Promise.all(userSpamMessages.map(msg => msg.delete()));

                    // Timeout the user
                    await message.member.timeout(config.timeoutDuration, 'Spam Detection');

                    // Log the case
                    const casesPath = path.join(__dirname, '..', 'cases.json');
                    const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

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

                    cases.push(spamCase);
                    fs.writeFileSync(casesPath, JSON.stringify(cases, null, 2));

                    // Notify staff
                    const staffChannel = client.channels.cache.get(config.staffChannelId);
                    if (staffChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle('⚠️ Spam Detection')
                            .setColor(0xFF0000)
                            .setDescription(`User ${message.author.toString()} has been timed out for spamming`)
                            .addFields(
                                { name: 'Channel', value: `<#${message.channel.id}>` },
                                { name: 'Content', value: message.content },
                                { name: 'Action Taken', value: `Timeout (${config.timeoutDuration / 1000}s)` },
                                { name: 'Messages sent', value: `${userMessages.length} messages in ${TIME_WINDOW / 1000}s` }
                            )
                            .setTimestamp();

                        await staffChannel.send({ embeds: [embed] });
                    }
                } catch (error) {
                    console.error('Error handling spam:', error);
                }
            }
        }
    }
};