'use strict';
// Fake llama-server used ONLY by automated integration tests. Never deploy this as a model.
const http = require('node:http');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
if (portIndex < 0) throw new Error('missing --port');
const port = Number(args[portIndex + 1]);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const prompt = JSON.parse(body).messages.at(-1).content;
      const content = /titulo curto/i.test(prompt) ? 'A ultima testemunha' :
        'Na cidade ficticia, a investigadora encontrou uma pista verificavel. ' +
        'O suspeito negou a acusacao e a investigacao prosseguiu ate o desfecho.';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
