const { EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config.json');
const fs = require('fs');
const path = require('path');

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: config.model });

// Constants
const CHECK_INTERVAL = 30*1000; // 30 seconds in milliseconds

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
        // Ignore bot messages and staff messages
        if (message.author.bot || message.member.roles.cache.has(config.staffRoleId)) return;

        // Load message history
        const messageHistoryPath = path.join(__dirname, '..', 'messageHistory.json');
        let messageHistory = JSON.parse(fs.readFileSync(messageHistoryPath, 'utf8'));

        // Initialize violations structure if doesn't exist
        if (
            !messageHistory.violations
            || !messageHistory.violations.pendingCheck
            || !messageHistory.violations.lastCheckTime
        ) {
            messageHistory.violations = {
                pendingCheck: [],
                lastCheckTime: Date.now()
            };
        }

        // Add message to pending check list
        messageHistory.violations.pendingCheck.push({
            content: message.content,
            authorId: message.author.id,
            authorTag: message.author.tag,
            channelId: message.channel.id,
            messageId: message.id,
            guildId: message.guild.id,
            timestamp: Date.now()
        });

        // Save updated history
        fs.writeFileSync(messageHistoryPath, JSON.stringify(messageHistory, null, 2));

        // Check if it's time to process messages
        const currentTime = Date.now();
        if (currentTime - messageHistory.violations.lastCheckTime >= CHECK_INTERVAL) {
            lastCheckTime = currentTime;

            try {
                // Get all pending messages
                const pendingMessages = messageHistory.violations.pendingCheck;
                if (pendingMessages.length === 0) return;

                // Batch process messages
                for (const msg of pendingMessages) {
                    const prompt = `Check if this message violates any rules. Rules: ${config.rules.join(', ')}
                    Message: "${msg.content}"
                    Response format: Only respond with "safe" or explain the violation briefly.`;

                    const result = await model.generateContent(prompt);
                    const response = result.response.text().toLowerCase();

                    // If response isn't "safe", alert staff
                    if (!response.includes('safe')) {
                        const staffChannel = client.channels.cache.get(config.staffChannelId);
                        if (staffChannel) {
                            const messageLink = `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.messageId}`;

                            const embed = new EmbedBuilder()
                                .setTitle('🚨 Suspicious Message Detected')
                                .setColor(0xFFA500)
                                .addFields(
                                    { name: 'User', value: `${msg.authorTag} (<@${msg.authorId}>)` },
                                    { name: 'Channel', value: `<#${msg.channelId}>` },
                                    { name: 'Content', value: msg.content.substring(0, 1024) },
                                    { name: 'AI Detection', value: response.substring(0, 1024) },
                                    { name: 'Message Link', value: `[Click to view message](${messageLink})` },
                                    { name: 'Time', value: new Date(msg.timestamp).toLocaleString() }
                                )
                                .setTimestamp();

                            await staffChannel.send({ embeds: [embed] });
                        }
                    }
                }

                // Clear pending messages after processing
                messageHistory.violations.pendingCheck = [];
                messageHistory.violations.lastCheckTime = currentTime;
                fs.writeFileSync(messageHistoryPath, JSON.stringify(messageHistory, null, 2));

            } catch (error) {
                console.error('Error in suspect alert system:', error);
            }
        }
    }
};