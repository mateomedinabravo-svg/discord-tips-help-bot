const { SlashCommandBuilder } = require('discord.js');

// solo las definiciones — el handler vive en index.js porque necesita el
// mismo estado interno (cooldown, contexto, cliente de Discord) que ya usa
// el resto del despacho de IA por mencion, y duplicarlo en otro archivo
// significaria mantener dos copias de la misma logica de seguridad
const preguntarDefinition = new SlashCommandBuilder()
  .setName('preguntar')
  .setDescription('Consultale algo a la IA en privado (solo vos ves la respuesta)')
  .addStringOption((opt) => opt.setName('pregunta').setDescription('Tu pregunta').setRequired(true).setMaxLength(300));

const explicarDefinition = new SlashCommandBuilder()
  .setName('explicar')
  .setDescription('La IA te explica como usar un comando del bot')
  .addStringOption((opt) => opt.setName('comando').setDescription('Nombre del comando (sin la barra)').setRequired(true));

module.exports = { preguntarDefinition, explicarDefinition };
