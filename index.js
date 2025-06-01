require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Define paths for persistent data files
const messageHistoryPath = path.join(__dirname, 'messageHistory.json');
const casesPath = path.join(__dirname, 'cases.json');
const violationsPath = path.join(__dirname, 'violations.json'); // New path for violations tracking

// Check and create messageHistory.json if it doesn't exist or is not in the new format
if (!fs.existsSync(messageHistoryPath)) {
    console.log('messageHistory.json not found, creating with new structure...');
    fs.writeFileSync(messageHistoryPath, JSON.stringify({ spam: {}, violations: {} }, null, 2), 'utf8');
} else {
    // Optional: Check if existing file has the new structure and update if necessary
    try {
        const historyData = fs.readFileSync(messageHistoryPath, 'utf8');
        const history = JSON.parse(historyData);
        let needsUpdate = false;
        if (!history.spam) {
            history.spam = {};
            needsUpdate = true;
        }
        if (!history.violations) {
            history.violations = {};
            needsUpdate = true;
        }
        if (needsUpdate) {
            console.log('Updating messageHistory.json to new structure...');
            fs.writeFileSync(messageHistoryPath, JSON.stringify(history, null, 2), 'utf8');
        }
    } catch (err) {
        console.error('Error reading or updating messageHistory.json:', err);
        // If error, overwrite with new structure to prevent further issues
        console.log('Overwriting messageHistory.json due to error...');
        fs.writeFileSync(messageHistoryPath, JSON.stringify({ spam: {}, violations: {} }, null, 2), 'utf8');
    }
}


// Check and create cases.json if it doesn't exist
if (!fs.existsSync(casesPath)) {
    console.log('cases.json not found, creating...');
    fs.writeFileSync(casesPath, '[]', 'utf8');
}

// Check and create violations.json if it doesn't exist
if (!fs.existsSync(violationsPath)) {
    console.log('violations.json not found, creating...');
    fs.writeFileSync(violationsPath, '{}', 'utf8');
}


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

client.commands = new Collection();
client.buttons = new Collection();

const commandsPath = path.join(__dirname, 'commands');
// Check if commands directory exists before reading
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        client.commands.set(command.structure.name, command);
    }
} else {
    console.log("Commands directory not found.");
}


const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
        client.once(event.event, (...args) => event.run(client, ...args));
    } else {
        client.on(event.event, (...args) => event.run(client, ...args));
    }
}

client.login(process.env.DISCORD_TOKEN);