const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPm2Controller } = require('../lib/bom-dia-pm2');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bom-pm2-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let online = true;
  const calls = [];
  const run = async (_, fullArgs) => {
    const args = fullArgs.slice(1); calls.push(args);
    if (args[0] === 'jlist') return { ok: true, text: JSON.stringify([{name:'bom-dia',pm_id:7,pid:online?123:0,pm2_env:{status:online?'online':'stopped',pm_exec_path:path.join(dir,'start.sh')}}]) };
    if (args[0] !== 'save') online = args[0] === 'start';
    return { ok: true, text: '' };
  };
  return { dir, calls, run, controller:createPm2Controller({servicePath:dir,run}) };
}
test('Bom Dia PM2 stop persists offline and start persists online, only its validated ID is controlled', async t => {
  const f = await fixture(t);
  assert.equal((await f.controller.set('stop')).state,'offline');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'desired.json'))).desired,'offline');
  assert.equal((await f.controller.set('start')).state,'online');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'desired.json'))).desired,'online');
  assert(f.calls.filter(a=>['start','stop'].includes(a[0])).every(a=>a[1]==='7'));
  assert.equal(f.calls.filter(a=>a[0]==='save').length,2);
});
test('Bom Dia PM2 rejects mismatched executable without starting or stopping anything', async t => {
  const f = await fixture(t); let called=0;
  const c=createPm2Controller({servicePath:f.dir,run:async()=>{called++;return {ok:true,text:JSON.stringify([{name:'bom-dia',pm_id:7,pm2_env:{pm_exec_path:'/unrelated.js'}}])}}});
  await assert.rejects(c.set('start'),{status:503});assert.equal(called,1);
  await assert.rejects(f.controller.set('restart'),{status:400});
});
test('Bom Dia reconciles only an intentional persisted stop, never starts a bot during reconciliation', async t => {
  const f=await fixture(t);
  await fs.writeFile(path.join(f.dir,'desired.json'),JSON.stringify({desired:'offline'}));
  await f.controller.reconcile();assert.equal((await f.controller.status()).state,'offline');
  assert(!f.calls.some(a=>a[0]==='start'));
});
