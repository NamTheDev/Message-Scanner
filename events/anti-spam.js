const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Ensure dotenv is loaded for API key

// Paths to persistent data files
const messageHistoryPath = path.join(__dirname, '..', 'messageHistory.json');
const casesPath = path.join(__dirname, '..', 'cases.json');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: config.model });

module.exports = {
    event: 'messageCreate',
    once: false,
    run: async (client, message) => {
        // Ignore bot messages or messages from users who are already timed out (optional, but good practice)
        if (message.author.bot || (message.member && message.member.isCommunicationDisabled())) return;

        const userId = message.author.id;
        const now = Date.now();

        let messageHistory = { spam: {}, violations: {} }; // Initialize with expected structure
        try {
            // Read message history from file
            const historyData = fs.readFileSync(messageHistoryPath, 'utf8');
            const parsedHistory = JSON.parse(historyData);
            // Ensure the structure is correct, default if not
            messageHistory.spam = parsedHistory.spam || {};
            messageHistory.violations = parsedHistory.violations || {};
        } catch (err) {
            // console.error('Error reading messageHistory.json:', err); // Suppress frequent errors if file is just missing initially
            // If file is unreadable or not found, initialize with empty history
            messageHistory = { spam: {}, violations: {} };
        }

        // Initialize spam history for the user if it doesn't exist
        if (!messageHistory.spam[userId]) {
            messageHistory.spam[userId] = [];
        }

        // Add the current message timestamp and content to the spam history
        messageHistory.spam[userId].push({
            timestamp: now,
            content: message.content
        });

        // *** Removed the time window filter. The AI will analyze all stored history for the user. ***
        // messageHistory.spam[userId] = messageHistory.spam[userId].filter(msg => now - msg.timestamp < config.spamTimeWindow);

        // Write updated history back to file
        try {
            fs.writeFileSync(messageHistoryPath, JSON.stringify(messageHistory, null, 2), 'utf8');
        } catch (err) {
            console.error('\nError writing messageHistory.json:', err);
        }

        // *** Removed the threshold check. AI will now analyze based on history for every message. ***
        // if (messageHistory.spam[userId].length >= config.spamThreshold) {

        const recentMessagesText = messageHistory.spam[userId]
            .map(msg => `- [${new Date(msg.timestamp).toISOString()}] ${msg.content}`)
            .join('\n');

        // Adjusted prompt to emphasize analyzing the entire history for repetition, rapid posting, and spam patterns
        const prompt = `Analyze the following sequence of recent messages from a user in a Discord server, including their timestamps. Determine if this sequence, as a whole, constitutes spamming. Spamming is defined as sending repetitive content (same or very similar messages), posting messages very rapidly, or exhibiting patterns commonly associated with spam (like repeated "DM me" phrases or unsolicited links). Based *only* on this analysis of the message history, decide if the user should be timed out. Respond with 'TIMEOUT' if spam is detected and the user should be timed out and their messages deleted, or 'NO_TIMEOUT' if spam is not detected. Provide a brief reason after the keyword.

Messages from user ${message.author.tag} in channel #${message.channel.name}:
${recentMessagesText}

Decision:`;

        let aiDecision = 'NO_TIMEOUT';
        let aiReason = 'AI analysis inconclusive or determined not spam.';

        try {
            console.log(`\nAsking AI to analyze potential spam for user ${message.author.tag}...`);
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim().toUpperCase();

            if (text.startsWith('TIMEOUT')) {
                aiDecision = 'TIMEOUT';
                aiReason = text.substring('TIMEOUT'.length).trim() || 'Spam detected by AI.';
                console.log(`\nAI decided: TIMEOUT for ${message.author.tag}. Reason: ${aiReason}`);
            } else {
                aiDecision = 'NO_TIMEOUT';
                aiReason = text.substring('NO_TIMEOUT'.length).trim() || 'AI determined not spam.';
                console.log(`\nAI decided: NO_TIMEOUT for ${message.author.tag}. Reason: ${aiReason}`);
            }

        } catch (aiError) {
            console.error('\nError calling Gemini AI:', aiError);
            aiDecision = 'NO_TIMEOUT'; // Default to no action on AI error
            aiReason = `AI error: ${aiError.message}`;
        }

        // Actions are now triggered solely by the AI's 'TIMEOUT' decision
        if (aiDecision === 'TIMEOUT') {
            // Spam confirmed by AI

            // Clear spam history for this user within the window to prevent immediate re-trigger
            // Keeping this to manage the size of the history file for frequent spammers
            messageHistory.spam[userId] = []; // Clear only spam history
            try {
                fs.writeFileSync(messageHistoryPath, JSON.stringify(messageHistory, null, 2), 'utf8');
            } catch (err) {
                console.error('\nError writing messageHistory.json after clearing spam history:', err);
            }

            try {
                // Timeout the user
                const member = message.guild.members.cache.get(userId);
                if (member) {
                    // Timeout duration is in milliseconds, using config.timeoutDuration
                    await member.timeout(config.timeoutDuration, `Spamming detected by AI: ${aiReason}`);
                    console.log(`\nTimed out user ${message.author.tag} for spamming.`);
                }

                // Delete recent messages from the user in this channel
                // Fetch up to 100 messages and filter by author
                const fetchedMessages = await message.channel.messages.fetch({ limit: 100 });
                const userMessages = fetchedMessages.filter(msg => msg.author.id === userId);

                if (userMessages.size > 0) {
                    // Bulk delete the user's messages
                    // Note: bulkDelete has limitations on messages older than 14 days
                    await message.channel.bulkDelete(userMessages, true);
                    console.log(`\nDeleted ${userMessages.size} messages from ${message.author.tag} in #${message.channel.name}.`);
                }

                // Create and send embed to staff channel
                const staffChannel = client.channels.cache.get(config.staffChannelId);
                if (staffChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle('Spam Detected (AI Confirmed)')
                        .setColor('Red') // You can choose a color
                        .addFields(
                            { name: 'User', value: `<@${userId}> (${message.author.tag})`, inline: true },
                            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'Timeout Duration', value: `${config.timeoutDuration / 1000} seconds`, inline: true },
                            { name: 'AI Reason', value: aiReason, inline: false },
                            { name: 'Example Message', value: `\`\`\`${message.content.substring(0, 200)}${message.content.length > 200 ? '...' : ''}\`\`\``, inline: false } // Use the current message as an example
                        )
                        .setTimestamp();

                    await staffChannel.send({ embeds: [embed] });
                    console.log(`\nSent spam report embed to staff channel.`);
                }

                // Save case details to cases.json
                let cases = [];
                try {
                    const casesData = fs.readFileSync(casesPath, 'utf8');
                    // If file is empty or contains invalid JSON, start with an empty array
                    cases = casesData ? JSON.parse(casesData) : [];
                } catch (err) {
                    console.error('\nError reading cases.json:', err);
                    // If file is unreadable or not found, initialize with empty array
                    cases = [];
                }

                // Add the new case
                cases.push({
                    type: 'spamming',
                    decisionMethod: 'AI', // Indicate AI made the decision
                    aiReason: aiReason,
                    userId: userId,
                    username: message.author.tag,
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    messageContent: message.content, // Save the message that triggered it
                    timestamp: new Date().toISOString()
                });

                // Write the updated cases array back to the file
                try {
                    fs.writeFileSync(casesPath, JSON.stringify(cases, null, 2), 'utf8');
                    console.log(`\nCase for user ${message.author.tag} saved to cases.json.`);
                } catch (writeErr) {
                    console.error('\nError writing to cases.json:', writeErr);
                }

            } catch (actionError) {
                console.error('\nError during anti-spam action (timeout/delete/embed):', actionError);
                // Optionally report error to staff channel
            }
        } else {
            // AI decided not to timeout. Log this.
            console.log(`\nAI decided NO_TIMEOUT for ${message.author.tag}. Reason: ${aiReason}`);
            // Optionally log this non-action to a specific channel or file
        }
        // } // *** Removed the closing brace for the threshold check ***
    },
};