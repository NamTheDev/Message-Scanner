// Import necessary modules from discord.js, Node.js, and load configuration
const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

// --- Command Definition ---

module.exports = {
    // Define the slash command's structure and options
    structure: new SlashCommandBuilder()
        .setName('cases')
        .setDescription('View moderation cases for a specific user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check cases for')
                .setRequired(true)),

    /**
     * Executes the /cases command.
     * @param {Interaction} interaction - The command interaction.
     */
    async execute(interaction) {
        // --- Permission Check ---

        // Ensure the user has the required staff role to use this command
        if (!interaction.member.roles.cache.has(config.staffRoleId)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: [MessageFlags.Ephemeral] // Ephemeral message visible only to the user
            });
        }

        // --- Data Retrieval ---

        const targetUser = interaction.options.getUser('user');
        const casesPath = path.join(__dirname, '..', 'cases.json');
        let cases = [];

        // Read and parse the cases.json file
        try {
            if (fs.existsSync(casesPath)) {
                cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
            }
        } catch (error) {
            console.error("Error reading or parsing cases.json:", error);
            return interaction.reply({
                content: 'There was an error retrieving the case data.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Filter cases to get only those for the specified user
        const userCases = cases.filter(case_ => case_.userId === targetUser.id);

        // --- Response Generation ---

        // If no cases are found, inform the staff member
        if (userCases.length === 0) {
            return interaction.reply({
                content: `No cases found for user ${targetUser.tag}`,
                flags: [MessageFlags.Ephemeral]
            });
        }

        // Create an embed to display the user's cases
        const embed = new EmbedBuilder()
            .setTitle(`Cases for ${targetUser.tag}`)
            .setColor(0xFF0000) // Red color for moderation-related embeds
            .setThumbnail(targetUser.displayAvatarURL()) // User's avatar
            .setTimestamp();

        // Group cases by the type of violation for better organization
        const groupedCases = userCases.reduce((acc, case_) => {
            if (!acc[case_.type]) {
                acc[case_.type] = [];
            }
            acc[case_.type].push(case_);
            return acc;
        }, {});

        // Add a field to the embed for each type of violation
        for (const [type, typeCases] of Object.entries(groupedCases)) {
            const casesSummary = typeCases.map(case_ => {
                const date = new Date(case_.timestamp).toLocaleDateString();
                return `• ${date}
${case_.actionTaken}`;
            }).join('\n\n');

            embed.addFields({
                name: `${type.charAt(0).toUpperCase() + type.slice(1)} Violations (${typeCases.length})`,
                value: casesSummary || 'No details available',
                inline: false
            });
        }

        // Send the embed as an ephemeral reply
        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    }
};
