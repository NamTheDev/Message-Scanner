const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Ensure dotenv is loaded for API key

// Paths to persistent data files
const messageHistoryPath = path.join(__dirname, '..', 'messageHistory.json');
const casesPath = path.join(__dirname, '..', 'cases.json');
const violationsPath = path.join(__dirname, '..', 'violations.json'); // Path for violations tracking

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: config.model });

// Define violation levels and their consequences
const VIOLATION_LEVELS = {
    STRICT: {
        timeoutDuration: 30 * 60 * 1000, // 30 minutes
        warningMessage: "You have received a warning and a temporary timeout for violating a strict rule.",
        banThreshold: 6, // Number of strict violations before ban recommendation
        banMessage: "You have accumulated too many strict violations and may be subject to a ban."
    },
    NON_STRICT: {
        warningThreshold: 3, // Number of non-strict warnings before timeout
        timeoutDuration: 30 * 60 * 1000, // 30 minutes for subsequent warnings
        warningMessage: "You have received a warning for violating a rule.",
        timeoutWarningMessage: "You have received a warning and a temporary timeout for repeatedly violating rules.",
        banThreshold: 6, // Total non-strict warnings before ban recommendation (3 initial + 3 with timeout)
        banMessage: "You have accumulated too many warnings and may be subject to a ban."
    }
};

module.exports = {
    event: 'messageCreate',
    once: false,
    run: async (client, message) => {
        // Ignore bot messages, messages from users with staff role, or timed out users
        const member = message.member;
        if (message.author.bot || (member && member.roles.cache.has(config.staffRoleId)) || (member && member.isCommunicationDisabled())) {
            return;
        }

        const userId = message.author.id;
        const now = Date.now();

        // --- Message History Handling (for AI analysis) ---
        let messageHistory = { spam: {}, violations: {} };
        try {
            const historyData = fs.readFileSync(messageHistoryPath, 'utf8');
            const parsedHistory = JSON.parse(historyData);
            messageHistory.spam = parsedHistory.spam || {};
            messageHistory.violations = parsedHistory.violations || {};
        } catch (err) {
            console.error('Error reading messageHistory.json for violations:', err);
            messageHistory = { spam: {}, violations: {} };
        }

        if (!messageHistory.violations[userId]) {
            messageHistory.violations[userId] = [];
        }

        // Add the current message to the violation history
        messageHistory.violations[userId].push({
            timestamp: now,
            content: message.content
        });

        // Keep history size manageable (e.g., last 50 messages for violations)
        const maxHistorySize = 50;
        if (messageHistory.violations[userId].length > maxHistorySize) {
            messageHistory.violations[userId] = messageHistory.violations[userId].slice(-maxHistorySize);
        }


        try {
            fs.writeFileSync(messageHistoryPath, JSON.stringify(messageHistory, null, 2), 'utf8');
        } catch (err) {
            console.error('\nError writing messageHistory.json for violations:', err);
        }

        // --- Violation Tracking Handling ---
        let violationsData = {};
        try {
            const data = fs.readFileSync(violationsPath, 'utf8');
            violationsData = JSON.parse(data);
        } catch (err) {
            // console.error('Error reading violations.json:', err); // Suppress if file is new
            violationsData = {}; // Initialize if file is empty or not found
        }

        if (!violationsData[userId]) {
            violationsData[userId] = { warnings: 0, strictViolations: 0, lastViolationTimestamp: 0 };
        }

        const userViolations = violationsData[userId];

        // --- AI Analysis ---
        const rulesList = config.rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n');
        const recentMessagesText = messageHistory.violations[userId]
            .map(msg => `- [${new Date(msg.timestamp).toISOString()}] ${msg.content}`)
            .join('\n');

        // Prompt for AI to analyze messages against rules
        const prompt = `Analyze the following sequence of recent messages from a user in a Discord server, including their timestamps, against the provided server rules. Identify if any rule is being violated by the user's communication *as a whole* or by specific messages within the history. Consider context, intent (like jokes vs. serious harm), and repetition, but prioritize direct rule violations.

Server Rules:
${rulesList}

Messages from user ${message.author.tag} in channel #${message.channel.name}:
${recentMessagesText}

Based *only* on this analysis of the message history and the rules, determine if a violation has occurred. If a violation is detected, identify which rule(s) were violated and determine the severity: 'STRICT' for rules 1 (racial slurs, etc.) or 'NON-STRICT' for rules 2 and 3 (advertisement, insults).

Respond with 'VIOLATION: [RuleNumber(s)] [Severity: STRICT/NON-STRICT] [Reason]' if a violation is detected, providing the number(s) of the violated rule(s), the severity, and a brief reason. If no violation is detected, respond with 'NO_VIOLATION: [Reason]'.

Decision:`;

        let aiDecision = 'NO_VIOLATION';
        let aiReason = 'AI analysis inconclusive or determined no violation.';
        let violationSeverity = null;
        let violatedRules = [];

        try {
            console.log(`\nAsking AI to analyze potential violation for user ${message.author.tag}...`);
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim(); // Keep original case for parsing

            if (text.startsWith('VIOLATION:')) {
                aiDecision = 'VIOLATION';
                // Attempt to parse the AI response format: VIOLATION: [RuleNumber(s)] [Severity] [Reason]
                const parts = text.substring('VIOLATION:'.length).trim().split(' ');
                if (parts.length >= 3) {
                    violatedRules = parts[0].replace(/\[|\]/g, '').split(',').map(r => parseInt(r.trim())).filter(r => !isNaN(r));
                    violationSeverity = parts[1].replace(/\[|\]/g, '').toUpperCase();
                    aiReason = parts.slice(2).join(' ').trim();
                } else {
                    // Fallback parsing if format is unexpected
                    violationSeverity = text.includes('STRICT') ? 'STRICT' : (text.includes('NON-STRICT') ? 'NON-STRICT' : null);
                    aiReason = text.substring('VIOLATION:'.length).trim();
                    console.warn(`\nAI response format unexpected for VIOLATION: ${text}`);
                }

                console.log(`\nAI decided: VIOLATION for ${message.author.tag}. Severity: ${violationSeverity}, Rules: ${violatedRules.join(',')}, Reason: ${aiReason}`);

            } else if (text.startsWith('NO_VIOLATION:')) {
                aiDecision = 'NO_VIOLATION';
                aiReason = text.substring('NO_VIOLATION:'.length).trim() || 'AI determined no violation.';
                console.log(`\nAI decided: NO_VIOLATION for ${message.author.tag}. Reason: ${aiReason}`);
            } else {
                // Handle unexpected AI response format
                aiDecision = 'NO_VIOLATION';
                aiReason = `AI returned unexpected format: ${text.substring(0, 100)}...`;
                console.warn(`\nAI returned unexpected response format: ${text}`);
            }

        } catch (aiError) {
            console.error('\nError calling Gemini AI for violations:', aiError);
            aiDecision = 'NO_VIOLATION'; // Default to no action on AI error
            aiReason = `AI error: ${aiError.message}`;
        }

        // --- Apply Punishment based on AI Decision and User History ---
        if (aiDecision === 'VIOLATION' && violationSeverity) {
            let punishmentApplied = false;
            let caseType = 'violation';
            let actionTaken = 'None';
            let staffEmbedTitle = 'Violation Detected (AI Confirmed)';
            let embedColor = 'Yellow'; // Default for warnings

            try {
                const member = message.guild.members.cache.get(userId);
                if (!member) {
                    console.error(`Could not find guild member with ID ${userId}`);
                    return; // Cannot apply punishment if member not found
                }

                if (violationSeverity === 'STRICT') {
                    userViolations.strictViolations++;
                    caseType = 'strict violation';
                    embedColor = 'Red';

                    if (userViolations.strictViolations <= VIOLATION_LEVELS.STRICT.banThreshold) {
                        // Apply timeout and warn
                        await member.timeout(VIOLATION_LEVELS.STRICT.timeoutDuration, `Strict violation detected by AI: ${aiReason}`);
                        await message.channel.send(`${member}, ${VIOLATION_LEVELS.STRICT.warningMessage}`);
                        actionTaken = `Timeout (${VIOLATION_LEVELS.STRICT.timeoutDuration / 1000}s) + Warning`;
                        console.log(`\nApplied timeout and warning for strict violation to ${message.author.tag}. Strict violations count: ${userViolations.strictViolations}`);
                        punishmentApplied = true;
                    } else {
                        // Recommend ban
                        actionTaken = 'Ban Recommended';
                        staffEmbedTitle = 'Strict Violation - Ban Recommended';
                        embedColor = 'DarkRed';
                        console.log(`\nStrict violation ban threshold reached for ${message.author.tag}. Ban recommended.`);
                        // No automatic ban, staff needs to review
                        punishmentApplied = true; // Log the case and notify staff
                    }

                } else if (violationSeverity === 'NON-STRICT') {
                    userViolations.warnings++;
                    caseType = 'non-strict violation';

                    if (userViolations.warnings <= VIOLATION_LEVELS.NON_STRICT.warningThreshold) {
                        // Just warn
                        await message.channel.send(`${member}, ${VIOLATION_LEVELS.NON_STRICT.warningMessage}`);
                        actionTaken = 'Warning';
                        console.log(`\nApplied warning for non-strict violation to ${message.author.tag}. Warnings count: ${userViolations.warnings}`);
                        punishmentApplied = true;
                    } else if (userViolations.warnings <= VIOLATION_LEVELS.NON_STRICT.banThreshold) {
                        // Apply timeout and warn for subsequent warnings
                        await member.timeout(VIOLATION_LEVELS.NON_STRICT.timeoutDuration, `Repeated non-strict violation detected by AI: ${aiReason}`);
                        await message.channel.send(`${member}, ${VIOLATION_LEVELS.NON_STRICT.timeoutWarningMessage}`);
                        actionTaken = `Timeout (${VIOLATION_LEVELS.NON_STRICT.timeoutDuration / 1000}s) + Warning`;
                        embedColor = 'Orange';
                        console.log(`\nApplied timeout and warning for repeated non-strict violation to ${message.author.tag}. Warnings count: ${userViolations.warnings}`);
                        punishmentApplied = true;
                    } else {
                        // Recommend ban
                        actionTaken = 'Ban Recommended';
                        staffEmbedTitle = 'Non-Strict Violation - Ban Recommended';
                        embedColor = 'DarkRed';
                        console.log(`\nNon-strict violation ban threshold reached for ${message.author.tag}. Ban recommended.`);
                        // No automatic ban, staff needs to review
                        punishmentApplied = true; // Log the case and notify staff
                    }
                }

                // Update last violation timestamp
                if (punishmentApplied) {
                    userViolations.lastViolationTimestamp = now;
                }


            } catch (actionError) {
                console.error('\nError during anti-violation action (timeout/warn):', actionError);
                actionTaken = `Error: ${actionError.message}`;
                embedColor = 'Grey'; // Indicate error
                punishmentApplied = true; // Still log the case with error info
            }

            // --- Save Violation Tracking Data ---
            try {
                fs.writeFileSync(violationsPath, JSON.stringify(violationsData, null, 2), 'utf8');
                if (punishmentApplied) {
                    console.log(`\nViolation data for user ${message.author.tag} saved to violations.json.`);
                }
            } catch (writeErr) {
                console.error('\nError writing to violations.json:', writeErr);
            }


            // --- Log Case and Notify Staff ---
            if (punishmentApplied) { // Only log/notify if a punishment/recommendation was triggered
                // Save case details to cases.json
                let cases = [];
                try {
                    const casesData = fs.readFileSync(casesPath, 'utf8');
                    cases = casesData ? JSON.parse(casesData) : [];
                } catch (err) {
                    console.error('\nError reading cases.json for violations:', err);
                    cases = [];
                }

                cases.push({
                    type: caseType,
                    decisionMethod: 'AI',
                    aiReason: aiReason,
                    violationSeverity: violationSeverity,
                    violatedRules: violatedRules,
                    userId: userId,
                    username: message.author.tag,
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    messageContent: message.content, // Save the message that triggered the check
                    actionTaken: actionTaken,
                    timestamp: new Date().toISOString()
                });

                try {
                    fs.writeFileSync(casesPath, JSON.stringify(cases, null, 2), 'utf8');
                    console.log(`\nCase for user ${message.author.tag} saved to cases.json.`);
                } catch (writeErr) {
                    console.error('\nError writing to cases.json:', writeErr);
                }

                // Create and send embed to staff channel
                const staffChannel = client.channels.cache.get(config.staffChannelId);
                if (staffChannel) {
                    const embed = new EmbedBuilder()
                        .setTitle(staffEmbedTitle)
                        .setColor(embedColor)
                        .addFields(
                            { name: 'User', value: `<@${userId}> (${message.author.tag})`, inline: true },
                            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'Severity', value: violationSeverity || 'Unknown', inline: true },
                            { name: 'Violated Rule(s)', value: violatedRules.length > 0 ? violatedRules.join(', ') : 'Unknown', inline: true },
                            { name: 'Action Taken', value: actionTaken, inline: false },
                            { name: 'AI Reason', value: aiReason, inline: false },
                            { name: 'Example Message', value: `\`\`\`${message.content.substring(0, 200)}${message.content.length > 200 ? '...' : ''}\`\`\``, inline: false },
                            { name: 'Total Warnings', value: userViolations.warnings.toString(), inline: true },
                            { name: 'Total Strict Violations', value: userViolations.strictViolations.toString(), inline: true }
                        )
                        .setTimestamp();

                    await staffChannel.send({ embeds: [embed] });
                    console.log(`\nSent violation report embed to staff channel.`);
                }
            }
        } else {
            // AI decided no violation, or parsing failed.
            console.log(`\nAI decided NO_VIOLATION for ${message.author.tag}. Reason: ${aiReason}`);
            // Optionally log non-violations for review if needed
        }
    },
};