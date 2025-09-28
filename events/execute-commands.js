// --- Event Handler for Slash Commands ---

module.exports = {
    event: 'interactionCreate', // Specifies which event this file handles

    /**
     * Executes when an interaction is created (e.g., a slash command is used).
     * @param {Client} client - The Discord client instance.
     * @param {Interaction} interaction - The interaction that was created.
     */
    async run(client, interaction) {
        // --- Command Type Check ---

        // We only want to handle slash commands, so ignore others (e.g., button clicks)
        if (!interaction.isCommand()) return;

        // --- Command Retrieval ---

        // Get the command from the client's command collection based on the interaction's command name
        const command = client.commands.get(interaction.commandName);

        // If the command doesn't exist, do nothing
        if (!command) return;

        // --- Command Execution & Error Handling ---

        try {
            // Execute the command's logic
            await command.execute(interaction);
        } catch (error) {
            // Log any errors that occur during command execution
            console.error('Error executing command:', error);
            
            // Prepare a user-friendly error message
            const reply = {
                content: 'There was an error executing this command.',
                ephemeral: true // The message will only be visible to the user who used the command
            };

            // Check if a reply has already been sent or deferred
            if (interaction.replied || interaction.deferred) {
                // If so, use followUp to send the error message
                await interaction.followUp(reply);
            } else {
                // Otherwise, send a new reply
                await interaction.reply(reply);
            }
        }
    }
};
