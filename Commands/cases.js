const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

module.exports = {
    structure: new SlashCommandBuilder()
        .setName('cases')
        .setDescription('View cases for a specific user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check cases for')
                .setRequired(true)),

    async execute(interaction) {
        // Check if user has staff role
        if (!interaction.member.roles.cache.has(config.staffRoleId)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('user');
        const casesPath = path.join(__dirname, '..', 'cases.json');
        const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

        // Filter cases for the specific user
        const userCases = cases.filter(case_ => case_.userId === targetUser.id);

        if (userCases.length === 0) {
            return interaction.reply({
                content: `No cases found for user ${targetUser.tag}`,
                ephemeral: true
            });
        }

        // Create embed for cases
        const embed = new EmbedBuilder()
            .setTitle(`Cases for ${targetUser.tag}`)
            .setColor(0xFF0000)
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp();

        // Group cases by type
        const groupedCases = userCases.reduce((acc, case_) => {
            if (!acc[case_.type]) acc[case_.type] = [];
            acc[case_.type].push(case_);
            return acc;
        }, {});

        // Add fields for each type of violation
        for (const [type, cases] of Object.entries(groupedCases)) {
            const casesSummary = cases.map(case_ => {
                const date = new Date(case_.timestamp).toLocaleDateString();
                return `• ${date}: ${case_.actionTaken}\n${case_.aiReason ? `Reason: ${case_.aiReason}` : ''}`;
            }).join('\n\n');

            embed.addFields({
                name: `${type.charAt(0).toUpperCase() + type.slice(1)} Violations (${cases.length})`,
                value: casesSummary || 'No details available',
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    }
};