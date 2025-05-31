
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const config = require('../config.json'); // Load the config file

// Get the rules in string
const rules = config.rules.join(", ")

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });

module.exports = {
    event: 'messageCreate',
    once: false,
    async run(client, message) {
        // Ignore messages from bots
        if (message.author.bot) return;

        // Ignore messages from staff members
        if (message.member && message.member.roles.cache.has(config.staffRoleId)) {
            return;
        }

        try {
            let contextMessageContent = '';
            // Check if the message is a reply and fetch the replied-to message
            if (message.reference && message.reference.messageId) {
                try {
                    const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);
                    if (repliedToMessage) {
                        contextMessageContent = `\nContext (replied to message): "${repliedToMessage.content}"`;
                    }
                } catch (fetchError) {
                    console.error('Could not fetch replied-to message:', fetchError);
                    // Continue without context if fetching fails
                }
            }

            // Construct the prompt for the AI
            const prompt = `
            Analyze the following message to see if it violates the following rules. Classify the violation type.

            Rules: "${rules}"

            Message: "${message.content}"

            Context message: "${contextMessageContent}"

            Respond with one of the following:
            - "HEAVY_VIOLATION" (for severe violations like racial slurs, rape, suicidal content, discrimination, offensive statements/jokes)
            - "HARMFUL" (for other harmful content like advertisement, personal information)
            - "SAFE" (if no rules are violated)
            `;

            // Send the prompt to the Gemini model
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim().toUpperCase();

            // Check the AI's response
            if (text === 'HARMFUL' || text === 'HEAVY_VIOLATION') {
                console.log(`Detected potentially harmful message from ${message.author.tag}: "${message.content}". Deleting...`);
                await message.delete();

                // --- Start of new code for timeout ---

                // Only apply timeout for heavy violations
                if (text === 'HEAVY_VIOLATION') {
                    console.log(`Detected heavy violation from ${message.author.tag}. Applying timeout...`);

                    const offensesFilePath = path.join(__dirname, '../offenses.json');
                    let offenses = {};

                    // Check if offenses file exists, create if not
                    if (!fs.existsSync(offensesFilePath)) {
                        try {
                            fs.writeFileSync(offensesFilePath, '{}', 'utf8');
                            console.log('Created offenses.json file.');
                        } catch (createError) {
                            console.error('Error creating offenses file:', createError);
                            // Continue, but offense data won't be saved
                        }
                    }

                    try {
                        // Read existing offense data
                        if (fs.existsSync(offensesFilePath)) { // Re-check in case creation failed
                            const data = fs.readFileSync(offensesFilePath, 'utf8');
                            offenses = JSON.parse(data);
                        }
                    } catch (readError) {
                        console.error('Error reading offenses file:', readError);
                        // Continue with empty offenses if read fails
                    }

                    const userId = message.author.id;
                    const currentOffenses = offenses[userId] || 0;
                    const newOffenses = currentOffenses + 1;
                    offenses[userId] = newOffenses;

                    // Define timeout durations in milliseconds
                    const timeoutDurations = [
                        2 * 60 * 1000,  // 2 minutes
                        5 * 60 * 1000,  // 5 minutes
                        10 * 60 * 1000, // 10 minutes
                        30 * 60 * 1000  // 30 minutes
                    ];

                    // Get the timeout duration based on offense count (cap at max duration)
                    const timeoutDuration = timeoutDurations[Math.min(newOffenses - 1, timeoutDurations.length - 1)];

                    // Apply timeout
                    if (message.member) {
                        try {
                            await message.member.timeout(timeoutDuration, 'Sending heavy violation content');
                            console.log(`Timed out ${message.author.tag} for ${timeoutDuration / 60000} minutes (Offense count: ${newOffenses}).`);

                            // Write updated offense data back to file
                            try {
                                fs.writeFileSync(offensesFilePath, JSON.stringify(offenses, null, 2), 'utf8');
                            } catch (writeError) {
                                console.error('Error writing offenses file:', writeError);
                            }

                        } catch (timeoutError) {
                            console.error(`Could not timeout ${message.author.tag}:`, timeoutError);
                            // This might happen if the bot doesn't have permissions or the user is the guild owner
                        }
                    } else {
                        console.log(`Could not timeout user ${message.author.tag} as member object is not available.`);
                    }
                } else {
                    console.log(`Message from ${message.author.tag} was harmful but not a heavy violation. Deleted message.`);
                }

                // --- End of new code for timeout ---

            } else {
                console.log(`Message from ${message.author.tag} is safe.`);
            }

        } catch (error) {
            console.error('Error scanning message with Gemini AI:', error);
            // Handle errors, maybe notify staff or log
        }
    },
};