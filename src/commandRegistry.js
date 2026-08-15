const announceCommand = require('./announceCommand');
const ticketCommand = require('./ticketCommand');
const levelCommands = require('./levelCommands');
const moderationCommands = require('./moderationCommands');
const housesCommand = require('./housesCommand');
const customCommands = require('./customCommands');

const STATIC_DEFINITIONS = [
  announceCommand.definition,
  ticketCommand.definition,
  levelCommands.nivelDefinition,
  levelCommands.rankingDefinition,
  moderationCommands.banDefinition,
  moderationCommands.kickDefinition,
  moderationCommands.muteDefinition,
  moderationCommands.warnDefinition,
  moderationCommands.warningsDefinition,
  housesCommand.definition,
].map((def) => def.toJSON());

async function registerGuildCommands(guild, config) {
  await customCommands.registerGuildCommands(guild, config, STATIC_DEFINITIONS);
}

module.exports = { STATIC_DEFINITIONS, registerGuildCommands };
