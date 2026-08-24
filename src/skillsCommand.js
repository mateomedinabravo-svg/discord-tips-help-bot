const { SlashCommandBuilder } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('skills')
  .setDescription('Etiquetate con tus habilidades (render, texturizado, animación, etc.) y buscá colaboradores')
  .addSubcommand((sub) =>
    sub
      .setName('agregar')
      .setDescription('Te asigna una skill configurada en este server')
      .addStringOption((opt) => opt.setName('skill').setDescription('Nombre de la skill').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('quitar')
      .setDescription('Te saca una skill')
      .addStringOption((opt) => opt.setName('skill').setDescription('Nombre de la skill').setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('ver')
      .setDescription('Ver las skills de alguien')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Usuario a consultar (por defecto, vos)')),
  )
  .addSubcommand((sub) =>
    sub
      .setName('buscar')
      .setDescription('Buscar quién tiene una skill puntual')
      .addStringOption((opt) => opt.setName('skill').setDescription('Nombre de la skill').setRequired(true)),
  );

function normalizeForMatch(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// resuelve los roles reales configurados como "skills" en este server (los
// unicos validos — un server puede tener 200 roles, pero solo estos cuentan
// como skill para /skills). Si config.skills no esta habilitado o no tiene
// roles elegidos, no hay ninguna skill valida
function resolveSkillRoles(guild, config) {
  const roleIds = config?.skills?.enabled ? config.skills.roleIds || [] : [];
  return roleIds.map((id) => guild.roles.cache.get(id)).filter(Boolean);
}

// mismo patron de "coincidencia mas larga gana" que se usa en el resto del
// bot para nombres de rol/canal por texto libre
function findSkillRoleByName(skillRoles, query) {
  const normalizedQuery = normalizeForMatch(query);
  return (
    skillRoles
      .filter((role) => normalizedQuery.includes(normalizeForMatch(role.name)) || normalizeForMatch(role.name).includes(normalizedQuery))
      .sort((a, b) => b.name.length - a.name.length)[0] || null
  );
}

function listSkillsText(skillRoles) {
  return skillRoles.length ? skillRoles.map((r) => `\`${r.name}\``).join(', ') : '(sin skills configuradas en este server)';
}

async function handleSkillsCommand(interaction, config) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply('Este comando solo funciona dentro de un server.');
    return;
  }

  const skillRoles = resolveSkillRoles(guild, config);
  if (!skillRoles.length) {
    await interaction.reply({
      content: '⚠️ Este server todavía no configuró ninguna skill. Un admin puede hacerlo desde el dashboard (página de Skills).',
      ephemeral: true,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'agregar' || sub === 'quitar') {
    const query = interaction.options.getString('skill', true);
    const role = findSkillRoleByName(skillRoles, query);
    if (!role) {
      await interaction.reply({ content: `⚠️ No encontré esa skill. Las disponibles son: ${listSkillsText(skillRoles)}`, ephemeral: true });
      return;
    }

    const member = await guild.members.fetch(interaction.user.id);
    if (sub === 'agregar') {
      if (member.roles.cache.has(role.id)) {
        await interaction.reply({ content: `Ya tenés la skill **${role.name}**.`, ephemeral: true });
        return;
      }
      await member.roles.add(role.id);
      await interaction.reply(`✅ Te agregué la skill **${role.name}**.`);
    } else {
      if (!member.roles.cache.has(role.id)) {
        await interaction.reply({ content: `No tenías la skill **${role.name}**.`, ephemeral: true });
        return;
      }
      await member.roles.remove(role.id);
      await interaction.reply(`✅ Te saqué la skill **${role.name}**.`);
    }
    return;
  }

  if (sub === 'ver') {
    const target = interaction.options.getUser('usuario') || interaction.user;
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: '⚠️ No encontré a ese usuario en el server.', ephemeral: true });
      return;
    }
    const memberSkillNames = skillRoles.filter((role) => member.roles.cache.has(role.id)).map((r) => r.name);
    await interaction.reply(
      `🛠️ Skills de <@${target.id}>: ${memberSkillNames.length ? memberSkillNames.map((n) => `\`${n}\``).join(', ') : '(ninguna todavía)'}`,
    );
    return;
  }

  if (sub === 'buscar') {
    const query = interaction.options.getString('skill', true);
    const role = findSkillRoleByName(skillRoles, query);
    if (!role) {
      await interaction.reply({ content: `⚠️ No encontré esa skill. Las disponibles son: ${listSkillsText(skillRoles)}`, ephemeral: true });
      return;
    }
    await guild.members.fetch();
    const memberNames = role.members.map((m) => m.displayName);
    await interaction.reply(
      memberNames.length
        ? `🔎 **${role.name}** — ${memberNames.length} persona(s): ${memberNames.slice(0, 40).join(', ')}${memberNames.length > 40 ? `, y ${memberNames.length - 40} más` : ''}`
        : `🔎 Nadie tiene la skill **${role.name}** todavía.`,
    );
  }
}

module.exports = { definition, handleSkillsCommand, resolveSkillRoles, findSkillRoleByName };
