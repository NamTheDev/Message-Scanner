const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const config = require('../config.json'); // Load config for staff role

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' }); // Use the same model

const HISTORY_SIZE = 4; // Keep track of the last N messages to analyze

// File paths for data
const kicksFilePath = path.join(__dirname, '../kicks.json');
const historyFilePath = path.join(__dirname, '../messageHistory.json'); // New history file path

// Function to read data from a JSON file
function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        // Create the file if it doesn't exist
        try {
            fs.writeFileSync(filePath, '{}', 'utf8');
            console.log(`Created ${path.basename(filePath)} file.`);
            return {};
        } catch (createError) {
            console.error(`Error creating ${path.basename(filePath)} file:`, createError);
            return {}; // Return empty object on error
        }
    }
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${path.basename(filePath)} file:`, error);
        return {}; // Return empty object on error
    }
}

// Function to write data to a JSON file
function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error writing ${path.basename(filePath)} file:`, error);
    }
}

module.exports = {
    event: 'messageCreate',
    once: false,
    async run(client, message) {
        // Ignore bots and staff members
        if (message.author.bot || (message.member && message.member.roles.cache.has(config.staffRoleId))) {
            return;
        }

        const userId = message.author.id;

        // Read current history data
        let userMessageHistory = readJsonFile(historyFilePath);

        // Get or initialize history for the user
        if (!userMessageHistory[userId]) {
            userMessageHistory[userId] = [];
        }
        const history = userMessageHistory[userId];

        // Add message to history
        history.push(message.content);

        // Keep history size limited
        if (history.length > HISTORY_SIZE) {
            history.shift(); // Remove the oldest message
        }

        // Write updated history back to file immediately
        writeJsonFile(historyFilePath, userMessageHistory);

        // Only analyze if history is full (or has enough messages to check for repetition)
        if (history.length === HISTORY_SIZE) {
            try {
                // Construct the prompt for the AI
                const prompt = `Analyze the following sequence of messages from a single user. Do they appear to be automated spam, bot-like behavior (e.g., repetitive, nonsensical patterns), or just normal human communication (even if it seems like "brainrot" or off-topic)?
                Messages:
                ${history.map((msg, index) => `${index + 1}: "${msg}"`).join('\n')}

                Respond with one of the following:
                - "BOT_SPAM" (if it looks like automated spam or bot behavior)
                - "HUMAN_LIKE" (if it looks like normal human communication, even if nonsensical or low quality)
                `;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const text = response.text().trim().toUpperCase();

                if (text === 'BOT_SPAM') {
                    console.log(`Detected potential bot/spam behavior from ${message.author.tag}. Messages: ${history.join(' | ')}`);

                    // Clear history for this user in the file data after detection
                    userMessageHistory[userId] = [];
                    writeJsonFile(historyFilePath, userMessageHistory); // Save cleared history

                    let kicks = readJsonFile(kicksFilePath); // Read kicks data
                    const currentKicks = kicks[userId] || 0;
                    const newKicks = currentKicks + 1;
                    kicks[userId] = newKicks;
                    writeJsonFile(kicksFilePath, kicks); // Write updated kicks data

                    if (message.member) {
                        try {
                            if (newKicks <= 2) {
                                // Kick the user on 1st and 2nd offense
                                await message.member.kick(`Detected bot/spam behavior (Kick ${newKicks}/2)`);
                                console.log(`Kicked ${message.author.tag} for bot/spam behavior (Kick ${newKicks}/2).`);
                            } else {
                                // Ban the user on 3rd offense
                                await message.member.ban({ reason: `Detected persistent bot/spam behavior (Kick ${newKicks - 1} prior)` });
                                console.log(`Banned ${message.author.tag} for persistent bot/spam behavior.`);
                            }
                        } catch (punishError) {
                            console.error(`Could not punish ${message.author.tag}:`, punishError);
                            // This might happen if the bot doesn't have permissions or the user is the guild owner
                        }
                    } else {
                        console.log(`Could not punish user ${message.author.tag} as member object is not available.`);
                    }
                } else {
                    // If not bot/spam, the messages are considered human-like, even if brainrot.
                    // No action needed, history is already saved.
                    console.log(`Messages from ${message.author.tag} classified as human-like.`);
                }

            } catch (error) {
                console.error('Error scanning message history with Gemini AI:', error);
                // Handle errors
            }
        }
    },
};