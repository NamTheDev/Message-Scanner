const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

// Initialize constants
const MESSAGE_HISTORY = new Map();
const FILTERED_CHANNELS = config.violation.exceptions;

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
        for (const ID of FILTERED_CHANNELS) {
            if (message.channel.id === ID) return;
        }
        if (message.author.bot || message.member.roles.cache.has(config.staffRoleId)) return;

        // Normalize the message content
        let normalizedContent = message.content.toLowerCase()
            // Remove special characters and symbols
            .replace(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~`]/g, '')
            // Remove extra spaces and dots
            .replace(/\s+/g, '')
            .replace(/\./g, '')
            // Replace common letter substitutions
            .replace(/0/g, 'o')
            .replace(/1/g, 'i')
            .replace(/3/g, 'e')
            .replace(/4/g, 'a')
            .replace(/5/g, 's')
            .replace(/7/g, 't')
            .replace(/8/g, 'b')
            .replace(/\$/g, 's')
            .replace('@', 'a');

        // Create regex from racial slurs array
        const slursPattern = new RegExp(config.violation.racialSlurs.join('|'), 'i');

        if (slursPattern.test(normalizedContent)) {
            // Delete the message
            await message.delete();

            // Get or initialize violation count for user
            let warningCount = (MESSAGE_HISTORY.get(message.author.id) || 0) + 1;
            MESSAGE_HISTORY.set(message.author.id, warningCount);

            // Send warning message that will delete itself after 5 seconds
            const warningMessage = await message.channel.send({
                content: `${message.author.toString()}, racial slurs are not allowed here. Warning ${warningCount}/${config.violation.maxWarnings}`
            });
            setTimeout(() => warningMessage.delete(), 5000);

            // If warnings exceed limit, timeout user
            if (warningCount >= config.violation.maxWarnings) {
                try {
                    // Timeout the user
                    await message.member.timeout(config.timeoutDuration, 'Multiple racial slur violations');

                    // Reset violation count
                    MESSAGE_HISTORY.set(message.author.id, 0);

                    // Notify staff
                    const staffChannel = client.channels.cache.get(config.staffChannelId);
                    if (staffChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle('⚠️ Racial Slur Violation')
                            .setColor(0xFF0000)
                            .setDescription(`User ${message.author.toString()} has been timed out for multiple racial slur violations`)
                            .addFields(
                                { name: 'Channel', value: `<#${message.channel.id}>` },
                                { name: 'Content', value: message.content },
                                { name: 'Action Taken', value: `Timeout (${config.timeoutDuration / 1000}s)` },
                                { name: 'Warning Count', value: `${warningCount}/${config.violation.maxWarnings}` }
                            )
                            .setTimestamp();

                        await staffChannel.send({ embeds: [embed] });
                    }
                } catch (error) {
                    console.error('Error handling racial slur violation:', error);
                }
            }
        }
    }
};