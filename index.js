require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Define paths for persistent data files
const casesPath = path.join(__dirname, 'cases.json');

// Check and create cases.json if it doesn't exist
if (!fs.existsSync(casesPath)) {
    console.log('cases.json not found, creating...');
    fs.writeFileSync(casesPath, '[]', 'utf8');
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