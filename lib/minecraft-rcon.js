const net = require('node:net');
// Only these two commands can cross this transport; never accept API text.
function rcon({ port, password }, action, { timeout = 60000 } = {}) {
  if (!['save', 'stop'].includes(action)) return Promise.reject(new Error('Ação RCON inválida.'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0), authenticated = false, settled = false;
    const timer = setTimeout(() => finish(new Error('RCON não confirmou a operação.')), timeout);
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) socket.destroy(); else socket.end();
      error ? reject(error) : resolve();
    }
    function send(id, type, text, callback) {
      const body = Buffer.from(text, 'utf8');
      const packet = Buffer.alloc(body.length + 14);
      packet.writeInt32LE(body.length + 10, 0); packet.writeInt32LE(id, 4); packet.writeInt32LE(type, 8);
      body.copy(packet, 12); socket.write(packet, callback);
    }
    socket.on('connect', () => send(1, 3, password));
    socket.on('error', () => finish(new Error('RCON local indisponível.')));
    socket.on('close', () => finish(new Error('RCON encerrou sem confirmar a operação.')));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 1024 * 1024) return finish(new Error('Resposta RCON inválida.'));
      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0);
        if (length < 10 || length > 1024 * 1024 - 4) return finish(new Error('Resposta RCON inválida.'));
        if (buffer.length < length + 4) return;
        const packet = buffer.subarray(0, length + 4); buffer = buffer.subarray(length + 4);
        if (packet.at(-1) !== 0 || packet.at(-2) !== 0) return finish(new Error('Resposta RCON inválida.'));
        const id = packet.readInt32LE(4), type = packet.readInt32LE(8);
        if (!authenticated && type === 2) {
          if (id !== 1) return finish(new Error('Autenticação RCON recusada.'));
          authenticated = true;
          send(2, 2, action === 'save' ? 'save-all flush' : 'stop', action === 'stop' ? error => finish(error ? new Error('Falha ao enviar parada RCON.') : null) : undefined);
        } else if (authenticated && action === 'save' && id === 2 && type === 0) {
          const text = packet.subarray(12, length + 2).toString('utf8');
          if (/Saved the game/.test(text)) finish();
          else if (!/Saving the game/.test(text)) finish(new Error('Salvamento não confirmado pelo Minecraft.'));
        }
      }
    });
  });
}
module.exports = { rcon };
