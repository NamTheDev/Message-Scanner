const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { default: Groq } = require('groq-sdk');

// Initialize AI
const GROQ_CLIENT = new Groq({
    apiKey: process.env.AI_KEY
});

// In-memory message store
const PENDING_MESSAGES = new Map();

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
        // Ignore bot messages and staff messages
        if (message.author.bot || message.member.roles.cache.has(config.staffRoleId)) return;

        // Add message to pending check list
        const messageData = {
            content: message.content,
            authorId: message.author.id,
            authorTag: message.author.tag,
            channelId: message.channel.id,
            messageId: message.id,
            guildId: message.guild.id,
            timestamp: Date.now()
        };

        PENDING_MESSAGES.set(message.id, messageData);

            try {
                // Get all pending messages
                if (PENDING_MESSAGES.size === 0) return;

                // Process messages in parallel for better performance
                const processingPromises = Array.from(PENDING_MESSAGES.values()).map(async (msg) => {
                    const prompt = `
                    Decide if this message violates any rules.

                    Must analyze carefully before deciding.

                    Rules: ${config.rules.join(', ')}
                    
                    Message: "${msg.content}"
                    Response format:
                    - Safe format
                    "Safe - no violation detected."
                    - Violation format
                    "Violation - [reason]"
                    `;

                    const result = await GROQ_CLIENT.chat.completions.create({
                        messages: [{ role: 'user', content: prompt }],
                        model: config.model
                    });
                    const response = result.choices[0].message.content.toLowerCase();

                    // If response isn't "safe", alert staff
                    if (response.length > 5 & response.startsWith("violation")) {
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
                });

                // Wait for all messages to be processed
                await Promise.all(processingPromises);

                // Clear pending messages after processing
                PENDING_MESSAGES.clear();

            } catch (error) {
                console.error('Error in suspect alert system:', error);
            }
    }
};