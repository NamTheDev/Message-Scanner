const { EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config.json');

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: config.model });

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
        // Ignore bot messages and staff messages
        if (message.author.bot || message.member.roles.cache.has(config.staffRoleId)) return;

        try {
            // Simple prompt to detect violations while conserving tokens
            const prompt = `Check if this message violates any rules. Rules: ${config.rules.join(', ')}
            Message: "${message.content}"
            Response format: Only respond with "safe" or explain the violation briefly.`;

            const result = await model.generateContent(prompt);
            const response = result.response.text().toLowerCase();

            // If response isn't "safe", alert staff
            if (!response.includes('safe')) {
                const staffChannel = client.channels.cache.get(config.staffChannelId);
                if (staffChannel) {
                    const messageLink = `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;

                    const embed = new EmbedBuilder()
                        .setTitle('🚨 Suspicious Message Detected')
                        .setColor(0xFFA500)
                        .addFields(
                            { name: 'User', value: `${message.author.tag} (${message.author.toString()})` },
                            { name: 'Channel', value: `<#${message.channel.id}>` },
                            { name: 'Content', value: message.content.substring(0, 1024) },
                            { name: 'AI Detection', value: response.substring(0, 1024) },
                            { name: 'Message Link', value: `[Click to view message](${messageLink})` }
                        )
                        .setTimestamp();

                    await staffChannel.send({ embeds: [embed] });
                }
            }
        } catch (error) {
            console.error('Error in suspect alert system:', error);
        }
    }
};