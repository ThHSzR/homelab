const test = require('node:test');
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
  assert.equal(second.cpu.percent,62.5);
  assert.equal(second.cpu.cores[0].percent,62.5);
});
