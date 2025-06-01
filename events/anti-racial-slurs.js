const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config.json');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: config.model });

module.exports = {
    event: 'messageCreate',
    async run(client, message) {
        if (message.author.bot || config.bypassRoleIds.some(roleId => message.member.roles.cache.has(roleId))) return;

        // Load message history and violations
        const messageHistoryPath = path.join(__dirname, '..', 'messageHistory.json');
        const violationsPath = path.join(__dirname, '..', 'violations.json');
        let messageHistory = JSON.parse(fs.readFileSync(messageHistoryPath, 'utf8'));
        let violations = JSON.parse(fs.readFileSync(violationsPath, 'utf8'));

        // Initialize user's message history if not exists
        if (!messageHistory.violations[message.author.id]) {
            messageHistory.violations[message.author.id] = [];
        }

        // Initialize user's violations if not exists
        if (!violations[message.author.id]) {
            violations[message.author.id] = {
                warnings: 0,
                strictViolations: 0,
                lastViolationTimestamp: 0
            };
        }

        // Get recent messages (within 30 seconds)
        const messages = await message.channel.messages.fetch({ limit: 10 });
        const recentMessages = messages.filter(msg =>
            Date.now() - msg.createdTimestamp <= 30000 && !msg.author.bot
        );

        // Prepare context for AI with message IDs
        const messageContext = recentMessages.map(msg =>
            `MessageID ${msg.id} - ${msg.author.username}: ${msg.content}`
        ).join('\n');

        // Prompt for AI
        const prompt = `Analyze the following chat messages for any racial slurs.

        Racial slurs: ${config.violation.racialSlurs.join(", ")}

        Notice: 
        - people can bypass, so try to decompose every words from the user.
        - always base on chat context to analyze.
        - include the MessageID of the violating message in your response.

Chat context:
${messageContext}

Should any message be flagged as inappropriate? Respond in this format:
{
    "isViolation": true/false,
    "messageId": "message ID of the violating message",
    "reason": "Detailed explanation if violation detected, otherwise 'No violation detected'"
}
"`;

        try {
            const result = await model.generateContent(prompt);
            const cleanedResponse = result.response.text()
                .replace(/```(?:json)?\s*|\s*```/g, '')
                .trim();
            
            const response = JSON.parse(cleanedResponse);

            if (response.isViolation && response.messageId) {
                // Find the violating message
                const violatingMessage = await message.channel.messages.fetch(response.messageId)
                    .catch(() => null);

                if (!violatingMessage) return;

                // Delete the specific violating message
                await violatingMessage.delete();

                // Update violations counter for the violating message author
                if (!violations[violatingMessage.author.id]) {
                    violations[violatingMessage.author.id] = {
                        warnings: 0,
                        strictViolations: 0,
                        lastViolationTimestamp: 0
                    };
                }

                violations[violatingMessage.author.id].warnings++;
                violations[violatingMessage.author.id].lastViolationTimestamp = Date.now();
                
                await message.channel.send(
                    `<@${violatingMessage.author.id}> ${violations[violatingMessage.author.id].warnings}/6 warn.\n> Refrain from using racial slurs.`
                );

                // Check punishment phases
                let actionTaken = "";
                if (violations[violatingMessage.author.id].warnings >= config.violation.maxWarnings * 2 && 
                    violations[violatingMessage.author.id].strictViolations >= config.violation.maxStrictViolations) {
                    // Phase 2: Potential ban
                    actionTaken = "Potential Ban - Staff Review Required";
                    notifyStaffForBan(client, violatingMessage, violations[violatingMessage.author.id], response.reason);
                } else if (violations[violatingMessage.author.id].warnings >= config.violation.maxWarnings) {
                    // Phase 1: Timeout
                    actionTaken = `Timeout (${config.timeoutDuration / 1000}s)`;
                    await violatingMessage.member.timeout(config.timeoutDuration, 'Racial Slurs Violation');
                    violations[violatingMessage.author.id].strictViolations++;
                } else {
                    actionTaken = "Warning";
                }

                // Log the case
                const casesPath = path.join(__dirname, '..', 'cases.json');
                const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

                const slurCase = {
                    type: "racial-slur",
                    decisionMethod: "AI",
                    aiReason: response.reason,
                    userId: violatingMessage.author.id,
                    username: violatingMessage.author.username,
                    messageId: violatingMessage.id,
                    channelId: violatingMessage.channel.id,
                    channelName: violatingMessage.channel.name,
                    messageContent: violatingMessage.content,
                    actionTaken,
                    timestamp: new Date().toISOString()
                };

                cases.push(slurCase);
                fs.writeFileSync(casesPath, JSON.stringify(cases, null, 2));

                // Notify staff
                notifyStaff(client, message, response.reason, actionTaken);

                // Save updated violations
                fs.writeFileSync(violationsPath, JSON.stringify(violations, null, 2));
            }
        } catch (error) {
            console.error('Error in anti-racial-slurs system:', error);
        }
    }
};

function notifyStaff(client, message, reason, actionTaken) {
    const staffChannel = client.channels.cache.get(config.staffChannelId);
    if (staffChannel) {
        const embed = new EmbedBuilder()
            .setTitle('🚫 Racial Slur Detection')
            .setColor(0xFF0000)
            .setDescription(`User ${message.author.toString()} violated content rules`)
            .addFields(
                { name: 'Channel', value: `<#${message.channel.id}>` },
                { name: 'Reason', value: reason },
                { name: 'Action Taken', value: actionTaken }
            )
            .setTimestamp();

        staffChannel.send({ embeds: [embed] });
    }
}

function notifyStaffForBan(client, message, userViolations, reason) {
    const staffChannel = client.channels.cache.get(config.staffChannelId);
    if (staffChannel) {
        const embed = new EmbedBuilder()
            .setTitle('⚠️ Ban Review Required')
            .setColor(0xFF0000)
            .setDescription(`User ${message.author.toString()} has reached ban threshold`)
            .addFields(
                { name: 'Total Warnings', value: userViolations.warnings.toString() },
                { name: 'Total Timeouts', value: userViolations.strictViolations.toString() },
                { name: 'Latest Violation', value: reason },
                { name: 'Action Required', value: 'Please review and consider banning this user.' }
            )
            .setTimestamp();

        staffChannel.send({
            content: `<@&${config.staffRoleId}> Ban review required!`,
            embeds: [embed]
        });
    }
}