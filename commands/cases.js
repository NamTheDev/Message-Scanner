const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

module.exports = {
    structure: new SlashCommandBuilder()
        .setName('cases')
        .setDescription('Manage user cases')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('View cases for a specific user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to check cases for')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a case from a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to remove case from')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('case_id')
                        .setDescription('The ID of the case to remove')
                        .setRequired(true))),

    async execute(interaction) {
        // Check if user has staff role
        if (!interaction.member.roles.cache.has(config.staffRoleId)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');
        const casesPath = path.join(__dirname, '..', 'cases.json');
        let cases = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

        // Filter cases for the specific user
        const userCases = cases.filter(case_ => case_.userId === targetUser.id);

        if (subcommand === 'list') {
            if (userCases.length === 0) {
                return interaction.reply({
                    content: `No cases found for user ${targetUser.tag}`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Create embed for cases
            const embed = new EmbedBuilder()
                .setTitle(`Cases for ${targetUser.tag}`)
                .setColor(0xFF0000)
                .setThumbnail(targetUser.displayAvatarURL())
                .setTimestamp();

            // Group cases by type and add case IDs
            const groupedCases = userCases.reduce((acc, case_, index) => {
                if (!acc[case_.type]) acc[case_.type] = [];
                // Add case ID to the case object
                case_.caseId = index;
                acc[case_.type].push(case_);
                return acc;
            }, {});

            // Add fields for each type of violation
            for (const [type, typeCases] of Object.entries(groupedCases)) {
                const casesSummary = typeCases.map(case_ => {
                    const date = new Date(case_.timestamp).toLocaleDateString();
                    return `• Case #${case_.caseId}: ${date}\n${case_.actionTaken}\n${case_.aiReason ? `Reason: ${case_.aiReason}` : ''}`;
                }).join('\n\n');

                embed.addFields({
                    name: `${type.charAt(0).toUpperCase() + type.slice(1)} Violations (${typeCases.length})`,
                    value: casesSummary || 'No details available',
                    inline: false
                });
            }

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });

        } else if (subcommand === 'remove') {
            const caseId = interaction.options.getInteger('case_id');

            // Check if case exists
            if (caseId >= cases.length || !cases[caseId] || cases[caseId].userId !== targetUser.id) {
                return interaction.reply({
                    content: `Invalid case ID for user ${targetUser.tag}`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

            // Remove the case
            const removedCase = cases.splice(caseId, 1)[0];
            fs.writeFileSync(casesPath, JSON.stringify(cases, null, 2));

            // Create embed for confirmation
            const embed = new EmbedBuilder()
                .setTitle('Case Removed')
                .setColor(0x00FF00)
                .setDescription(`Successfully removed case #${caseId} from ${targetUser.tag}`)
                .addFields(
                    { name: 'Type', value: removedCase.type },
                    { name: 'Action Taken', value: removedCase.actionTaken },
                    { name: 'Timestamp', value: new Date(removedCase.timestamp).toLocaleDateString() }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        }
    }
};