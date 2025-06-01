module.exports = {
    event: 'interactionCreate',
    async run(client, interaction) {
        // Only handle slash commands
        if (!interaction.isCommand()) return;

        const command = client.commands.get(interaction.commandName);

        // If command doesn't exist, ignore
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error('Error executing command:', error);
            
            // If the interaction hasn't been replied to yet, send an error message
            const reply = {
                content: 'There was an error executing this command.',
                ephemeral: true
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    }
};