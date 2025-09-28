// Import necessary modules from discord.js and load configuration
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

// --- Module-level constants ---

// In-memory store for tracking user violation history (message counts)
const MESSAGE_HISTORY = new Map();

// Channels to be exempted from racial slur checks
const FILTERED_CHANNELS = config.violation.exceptions;

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

        // --- Message Normalization ---

        // Normalize the message content to detect slurs more effectively.
        // This includes converting to lowercase, removing special characters, and substituting common evasive characters.
        let normalizedContent = message.content.toLowerCase()
            .replace(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/g, '') // Remove special characters
            .replace(/\s+/g, '') // Remove spaces
            .replace(/\./g, '') // Remove dots
            .replace(/0/g, 'o') // Character substitutions
            .replace(/1/g, 'i')
            .replace(/3/g, 'e')
            .replace(/4/g, 'a')
            .replace(/5/g, 's')
            .replace(/7/g, 't')
            .replace(/8/g, 'b')
            .replace(/\$/g, 's')
            .replace('@', 'a');

        // --- Slur Detection ---

        // Create a regular expression from the list of racial slurs in the config
        const slursPattern = new RegExp(config.violation.racialSlurs.join('|'), 'i');

        // Check if the normalized message content matches the slur pattern
        if (slursPattern.test(normalizedContent)) {
            // --- Actions on Detection ---

            // Delete the offending message immediately
            await message.delete();

            // Increment the user's warning count
            let warningCount = (MESSAGE_HISTORY.get(message.author.id) || 0) + 1;
            MESSAGE_HISTORY.set(message.author.id, warningCount);

            // Send a temporary warning message to the channel
            const warningMessage = await message.channel.send({
                content: `${message.author.toString()}, racial slurs are not allowed here. Warning ${warningCount}/${config.violation.maxWarnings}`
            });
            setTimeout(() => warningMessage.delete(), 5000); // Message deletes after 5 seconds

            // --- Escalation ---

            // If the user exceeds the maximum number of warnings, take further action
            if (warningCount >= config.violation.maxWarnings) {
                try {
                    // Timeout the user for the duration specified in the config
                    await message.member.timeout(config.timeoutDuration, 'Multiple racial slur violations');

                    // Reset the user's warning count
                    MESSAGE_HISTORY.set(message.author.id, 0);

                    // --- Staff Notification ---

                    // Get the staff notification channel
                    const staffChannel = client.channels.cache.get(config.staffChannelId);
                    
                    if (staffChannel) {
                        // Create an embed to log the incident
                        const embed = new EmbedBuilder()
                            .setTitle('⚠️ Racial Slur Violation')
                            .setColor(0xFF0000) // Red color for violations
                            .setDescription(`User ${message.author.toString()} has been timed out for multiple racial slur violations`)
                            .addFields(
                                { name: 'Channel', value: `<#${message.channel.id}>` },
                                { name: 'Content', value: message.content },
                                { name: 'Action Taken', value: `Timeout (${config.timeoutDuration / 1000}s)` },
                                { name: 'Warning Count', value: `${warningCount}/${config.violation.maxWarnings}` }
                            )
                            .setTimestamp();

                        // Send the embed to the staff channel
                        await staffChannel.send({ embeds: [embed] });
                    }
                } catch (error) {
                    console.error('Error handling racial slur violation:', error);
                }
            }
        }
    }
};
