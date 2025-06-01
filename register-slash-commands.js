require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Create a collection of commands
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Load all command files
for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    commands.push(command.structure.toJSON());
}

// Initialize REST client
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Function to register commands
(async () => {
    try {
        console.log('Started refreshing application (/) commands...');

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log('Successfully registered application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();