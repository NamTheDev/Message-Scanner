const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
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

            // Load message history for tracking warnings
            const messageHistoryPath = path.join(__dirname, '..', 'messageHistory.json');
            let messageHistory = JSON.parse(fs.readFileSync(messageHistoryPath, 'utf8'));

            if (!messageHistory.violations[message.author.id]) {
                messageHistory.violations[message.author.id] = 0;
            }

            messageHistory.violations[message.author.id]++;
            const warningCount = messageHistory.violations[message.author.id];

            // Save updated history
            fs.writeFileSync(messageHistoryPath, JSON.stringify(messageHistory, null, 2));

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

                    // Log the case
                    const casesPath = path.join(__dirname, '..', 'cases.json');
                    const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

                    const slurCase = {
                        type: "racial_slur",
                        decisionMethod: "Auto",
                        userId: message.author.id,
                        username: message.author.username,
                        channelId: message.channel.id,
                        channelName: message.channel.name,
                        messageContent: message.content,
                        actionTaken: "Timeout",
                        timestamp: new Date().toISOString()
                    };

                    cases.push(slurCase);
                    fs.writeFileSync(casesPath, JSON.stringify(cases, null, 2));

                    // Reset violation count
                    messageHistory.violations[message.author.id] = 0;
                    fs.writeFileSync(messageHistoryPath, JSON.stringify(messageHistory, null, 2));

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