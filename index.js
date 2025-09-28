// Load environment variables from .env file
require('dotenv').config();

// Import necessary modules from discord.js
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');

// Import Node.js built-in modules for file and path handling
const fs = require('fs');
const path = require('path');

// Initialize the Discord client with necessary intents and partials
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,         // Required for guild-related events
        GatewayIntentBits.GuildMessages,  // Required for message-related events
        GatewayIntentBits.MessageContent, // Required to read message content
    ],
    partials: [Partials.Channel], // Required to handle events in channels that might not be cached
});

// Create collections to store commands and buttons
client.commands = new Collection();
client.buttons = new Collection();

// --- Command Handler ---
const commandsPath = path.join(__dirname, 'commands');

// Check if the 'commands' directory exists
if (fs.existsSync(commandsPath)) {
    // Read all JavaScript files in the 'commands' directory
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    // Loop through each command file and load it
    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        // Add the command to the client's command collection
        client.commands.set(command.structure.name, command);
    }
} else {
    console.log("Commands directory not found, skipping command loading.");
}

// --- Event Handler ---
const eventsPath = path.join(__dirname, 'events');

// Read all JavaScript files in the 'events' directory
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

// Loop through each event file and set up the event listeners
for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));

    // Differentiate between events that should run once and those that run every time
    if (event.once) {
        // For 'once' events, register a listener that triggers only the first time
        client.once(event.event, (...args) => event.run(client, ...args));
    } else {
        // For regular events, register a listener that triggers every time
        client.on(event.event, (...args) => event.run(client, ...args));
    }
}

// Log in to Discord with the bot token from the environment variables
client.login(process.env.DISCORD_TOKEN);
