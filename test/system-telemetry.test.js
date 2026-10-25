const test = require('node:test');
const {parseAdbWifi} = require('../lib/system-telemetry');

const adbWifiFixture = 'Wifi is connected to "LAB_TEST"\nWifiInfo: SSID: LAB_TEST, RSSI: -42, Link speed: 72Mbps, Frequency: 2427MHz\nIPv4:\n4: wlan0 inet 192.0.2.5/24 brd 192.0.2.255 scope global wlan0';
test('ADB Wi-Fi preserves connection fields and rejects disconnected output', () => {
  assert.deepEqual(parseAdbWifi(adbWifiFixture), {available:true,ssid:'LAB_TEST',source:'adb-cmd-wifi',
    ip:'192.0.2.5',rssi:-42,linkSpeedMbps:72,frequencyMhz:2427});
  assert.equal(parseAdbWifi('Wifi is disabled').available,false);
});

test('a provisioned ADB gateway supplies Wi-Fi without waking Termux API', async () => {
  const calls=[];
  const sampler=createSystemSampler({termux:true,fsList:async()=>[],
    fsRead:async p=>p.endsWith('device-serial')?'127.0.0.1:5555':null,
    run:async (file,args)=>{calls.push([file,args]);return {ok:true,text:file==='bash'?adbWifiFixture:'Android'};}});
  assert.equal((await sampler.sample()).wifi.source,'adb-cmd-wifi');
  assert.equal(calls.filter(([file])=>file.startsWith('termux-')).length,0);
  assert.ok(calls.some(([file,args])=>file==='bash' && args[1]==='wifi'));
});

test('an unavailable provisioned gateway does not fall back to Termux API', async () => {
  const calls=[];
  const sampler=createSystemSampler({termux:true,fsList:async()=>[],
    fsRead:async p=>p.endsWith('device-serial')?'127.0.0.1:5555':null,
    run:async (file,args)=>{calls.push([file,args]);return {ok:false,text:''};}});
  assert.equal((await sampler.sample()).wifi.available,false);
  assert.equal(calls.filter(([file])=>file.startsWith('termux-')).length,0);
});
const assert = require('node:assert/strict');
const {
  parseCpu, cpuUsage, parseMemory, parsePressure, parseNetDev, networkRates,
  parseThermal, parseWifi, createSystemSampler
} = require('../lib/system-telemetry');

test('system telemetry computes CPU usage per core across samples without guessing a first value', () => {
  const before = parseCpu('cpu 100 0 0 900 0\ncpu0 40 0 0 60 0\ncpu1 60 0 0 840 0');
  const after = parseCpu('cpu 160 0 0 940 0\ncpu0 70 0 0 70 0\ncpu1 90 0 0 870 0');
  assert.equal(cpuUsage(null, before)[0].percent, null);
  assert.equal(cpuUsage(before, after)[0].percent, 60);
  assert.equal(cpuUsage(before, after)[1].percent, 75);
  assert.equal(cpuUsage(before, after)[2].percent, 50);
});

test('RAM metrics distinguish available memory, cache and real swap usage', () => {
  const info = parseMemory('MemTotal: 4096000 kB\nMemAvailable: 1024000 kB\nCached: 512000 kB\nSwapTotal: 2097152 kB\nSwapFree: 1048576 kB');
  assert.equal(info.totalBytes, 4096000 * 1024);
  assert.equal(info.availableBytes, 1024000 * 1024);
  assert.equal(info.swapUsedBytes, 1048576 * 1024);
  assert.equal(parseMemory('Permission denied'), null);
});

test('resource pressure and thermal sensors reject unknown or invalid readings', () => {
  const pressure = parsePressure('some avg10=0.21 avg60=0.05 avg300=0.00 total=42\nfull avg10=0.01 avg60=0.00 avg300=0.00 total=12');
  assert.equal(pressure.some.avg10, 0.21);
  assert.equal(pressure.full.avg10, 0.01);
  assert.equal(parsePressure('permission denied'), null);
  assert.equal(parseThermal('battery', '37250\n', 'thermal_zone1').celsius, 37.3);
  assert.equal(parseThermal('cpu', '9000000', 'thermal_zone4'), null);
});

test('network interface counters show rates only after a previous sample', () => {
  const before = parseNetDev('Inter-|\nface | bytes\nwlan0: 1000 10 1 2 0 0 0 0 500 5 0 0 0 0 0 0');
  const after = parseNetDev('Inter-|\nface | bytes\nwlan0: 1600 16 1 2 0 0 0 0 800 8 0 0 0 0 0 0');
  assert.equal(networkRates([], before, 10)[0].rxPerSecond, null);
  assert.equal(networkRates(before, after, 2)[0].rxPerSecond, 300);
  assert.equal(networkRates(before, after, 2)[0].txPerSecond, 150);
  assert.equal(after[0].rxErrors, 1);
  assert.equal(after[0].rxDrops, 2);
});

test('Termux Wi-Fi data is optional and parse failures are explicit', () => {
  assert.equal(parseWifi('not json').available, false);
  const wifi = parseWifi(JSON.stringify({ ssid:'Home', rssi:-59, link_speed_mbps:144, frequency_mhz:5180 }));
  assert.equal(wifi.ssid, 'Home');
  assert.equal(wifi.rssi, -59);
  assert.equal(wifi.frequencyMhz, 5180);
});

test('restricted and empty Android responses never invent temperature or Wi-Fi connectivity', () => {
  for (const value of [null, undefined, '', ' \n', 'permission denied'])
    assert.equal(parseThermal('cpu', value, 'thermal_zone0'), null);
  assert.equal(parseThermal('cpu', '0', 'thermal_zone0').celsius, 0);
  for (const value of [{ error: 'Permission denied' }, {}, { ssid: '<unknown ssid>', rssi: -127 }])
    assert.equal(parseWifi(JSON.stringify(value)).available, false);
});

test('denied directory listings keep readable RAM and device telemetry without inventing a process count', async () => {
  const sampler = createSystemSampler({ termux:false,
    fsRead: async p => p === '/proc/meminfo' ? 'MemTotal: 1000 kB\nMemAvailable: 500 kB' : null,
    fsList: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }
  });
  const value = await sampler.sample();
  assert.equal(value.memory.availableBytes, 500 * 1024);
  assert.equal(value.device.visibleProcesses, null);
  assert.equal(value.cpu.available, false);
  assert.equal(value.thermal.available, false);
  assert.deepEqual(value.thermal.sensors, []);
});

test('CPU and interface counters require a new baseline after a denied or empty cycle', async () => {
  let time = 1000, readable = true, ticks = 10, bytes = 100;
  const sampler = createSystemSampler({ termux:false, clock:()=>time, fsList:async()=>[],
    fsRead:async p => !readable ? null : p === '/proc/stat' ? `cpu ${ticks} 0 0 90 0` :
      p === '/proc/net/dev' ? `Inter-|\nface | bytes\nwlan0: ${bytes} 0 0 0 0 0 0 0 ${bytes} 0 0 0 0 0 0 0` : null
  });
  await sampler.sample();
  time += 1000; readable = false;
  assert.equal((await sampler.sample()).cpu.available, false);
  time += 1000; readable = true; ticks = 30; bytes = 300;
  const resumed = await sampler.sample();
  assert.equal(resumed.cpu.percent, null);
  assert.equal(resumed.interfaces[0].rxPerSecond, null);
  time += 1000; ticks = 50; bytes = 500;
  const next = await sampler.sample();
  assert.equal(next.cpu.percent, 100);
  assert.equal(next.interfaces[0].rxPerSecond, 200);
});

test('system sampler returns null for denied sensors and calculates CPU on next cycle', async () => {
  const files = new Map([
    ['/proc/stat','cpu 20 0 0 80 0\ncpu0 20 0 0 80 0'],
    ['/proc/meminfo','MemTotal: 1000 kB\nMemAvailable: 500 kB'],
    ['/proc/net/dev','Inter-|\nface | bytes\n'],
    ['/sys/class/thermal/thermal_zone0/type','battery'],
    ['/sys/class/thermal/thermal_zone0/temp','35000']
  ]);
  let timestamp = 1000;
  const sampler = createSystemSampler({
    termux:false,clock:()=>timestamp,
    fsRead:async p=>files.get(p) ?? null,
    fsList:async p=>p==='/sys/class/thermal'?['thermal_zone0']:p==='/proc'?['1','2','self']:[]
  });
  const first = await sampler.sample();
  assert.equal(first.cpu.percent,null);
  assert.equal(first.thermal.sensors[0].celsius,35);
  assert.equal(first.device.visibleProcesses,2);
  assert.equal(first.wifi.available,false);
  files.set('/proc/stat','cpu 70 0 0 130 0\ncpu0 70 0 0 130 0');
  timestamp = 16000;
  const second = await sampler.sample();
  assert.equal(second.cpu.percent,50);
  assert.equal(second.cpu.cores[0].percent,50);
});
