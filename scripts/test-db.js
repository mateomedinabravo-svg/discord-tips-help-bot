require('dotenv').config();
const db = require('../src/db');

(async () => {
  try {
    const config = await db.getGuildConfig('test-connection-check');
    console.log('✅ Conexión OK. Tips por defecto cargados:', config.tips.length);
    const database = await db.connect();
    await database.collection('guildConfig').deleteOne({ guildId: 'test-connection-check' });
    console.log('✅ Limpieza OK. Todo listo.');
    process.exit(0);
  } catch (err) {
    console.error('❌ FALLO DE CONEXIÓN:', err.message);
    process.exit(1);
  }
})();
