const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const flush = async () => { for (let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve)); };

async function fixture(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),
    {url:'https://homelab.thsouza.eng.br',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window;
  w.AbortSignal=AbortSignal;
  w.setInterval=()=>0;
  w.fetch=async url=>{
    if (url.startsWith('/api/services')) return new Response(JSON.stringify({
      'bom-dia':{state:'offline',available:false},
      minecraft:{state:'offline',available:false},
      'tailscale-userspace':{state:'offline',available:false}
    }));
    if (url.startsWith('/api/modules')) return new Response('[]');
    return new Response('{}',{status:503});
  };
  w.eval(fs.readFileSync(path.join(root,'public/insights.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(root,'public/app.js'),'utf8'));
  await flush();
  return w;
}

test('system telemetry renders per-core samples, swap and sensor data without extra cards',async t=>{
  const w=await fixture(t);
  const s={timestamp:new Date().toISOString(),
    device:{model:'Galaxy A30',android:'11',hostname:'galaxy-a30',architecture:'arm64',kernel:'5.4',node:'v22',visibleProcesses:12},
    cpu:{percent:37.5,count:2,cores:[{core:'cpu0',percent:20,frequencyMhz:1200},{core:'cpu1',percent:55,frequencyMhz:null}]},
    memory:{totalBytes:4000000000,availableBytes:1200000000,swapTotalBytes:2000000000,swapUsedBytes:1000000000},
    wifi:{available:true,ssid:'Lab',rssi:-55},
    thermal:{sensors:[{sensor:'thermal_zone0',type:'battery',celsius:35}]},
    pressure:{cpu:{some:{avg10:0.6}},memory:null,io:null},
    interfaces:[{name:'wlan0',rxBytes:1000,txBytes:600,rxPerSecond:200,txPerSecond:100,rxErrors:0,rxDrops:0,txErrors:0,txDrops:0}]
  };
  w.renderSystem(s,false);
  const doc=w.document;
  assert.match(doc.querySelector('#system-highlights').textContent,/37,5%/);
  assert.match(doc.querySelector('#system-highlights').textContent,/Lab/);
  assert.match(doc.querySelector('#system-memory').textContent,/Swap utilizado/);
  assert.equal(doc.querySelectorAll('#system-cores .core-row').length,2);
  assert.match(doc.querySelector('#system-thermal').textContent,/35/);
  assert.match(doc.querySelector('#system-ifaces').textContent,/wlan0/);
  assert.equal(doc.querySelectorAll('#health-card-minecraft [role=switch]').length,1);
});

test('unknown Android permissions show unavailable and compact diagnostics can open from hash',async t=>{
  const w=await fixture(t);
  const doc=w.document;
  w.renderSystem({timestamp:new Date().toISOString(),cpu:{percent:null,cores:[],count:0},
    device:{},memory:null,thermal:{sensors:[]},pressure:{},interfaces:[],
    wifi:{available:false,reason:'Termux:API sem permissão'}},false);
  assert.match(doc.querySelector('#system-highlights').textContent,/Termux:API sem permissão/);
  assert.match(doc.querySelector('#system-thermal').textContent,/Indisponíveis/);
  assert.equal(doc.querySelector('#advanced').open,false);
  w.location.hash='#devices';
  w.dispatchEvent(new w.Event('hashchange'));
  assert.equal(doc.querySelector('#advanced').open,true);
  assert.ok(doc.querySelector('#logs'));
  assert.ok(doc.querySelector('#terminal-launcher'));
});
