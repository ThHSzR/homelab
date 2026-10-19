const os = require('node:os');
const fs = require('node:fs/promises');
const { command } = require('./collectors');
const read = p => fs.readFile(p, 'utf8').catch(() => null);
function parseCpu(text) {
  return String(text || '').split('\n').map(line => {
    const m = /^cpu(\d*)\s+(.+)$/.exec(line.trim());
    if (!m) return null;
    const numbers = m[2].trim().split(/\s+/).map(Number);
    if (numbers.length < 4 || numbers.some(n => !Number.isFinite(n))) return null;
    return { name: m[1] ? 'cpu' + m[1] : 'total',
      ticks: numbers.reduce((sum,n) => sum+n, 0), idle: numbers[3] + (numbers[4] || 0) };
  }).filter(Boolean);
}
function cpuUsage(previous, current) {
  const prev = new Map((previous || []).map(v => [v.name,v]));
  return current.map(v => {
    const old = prev.get(v.name), total = old ? v.ticks-old.ticks : 0,
      idle = old ? v.idle-old.idle : 0;
    return { core: v.name, percent: total > 0 && idle >= 0 && idle <= total
      ? Math.round((total-idle)/total*1000)/10 : null };
  });
}
function parseMemory(text) {
  const v = {};
  for (const m of String(text||'').matchAll(/^([A-Za-z_()]+):\s+(\d+)\s+kB/gm)) v[m[1]] = +m[2]*1024;
  if (!v.MemTotal) return null;
  return { totalBytes: v.MemTotal, availableBytes: v.MemAvailable ?? null,
    cachedBytes: v.Cached ?? null, buffersBytes: v.Buffers ?? null,
    activeBytes: v.Active ?? null, inactiveBytes: v.Inactive ?? null,
    slabBytes: v.Slab ?? null, dirtyBytes: v.Dirty ?? null,
    swapTotalBytes: v.SwapTotal ?? null, swapUsedBytes: v.SwapTotal != null && v.SwapFree != null
      ? Math.max(0,v.SwapTotal-v.SwapFree) : null };
}
function parsePressure(text) {
  const result = {};
  for (const m of String(text||'').matchAll(/^(some|full)\s+avg10=([\d.]+)\s+avg60=([\d.]+)\s+avg300=([\d.]+)/gm))
    result[m[1]] = { avg10:+m[2], avg60:+m[3], avg300:+m[4] };
  return Object.keys(result).length ? result : null;
}
function parseNetDev(text) {
  const result = [];
  for (const line of String(text||'').split('\n').slice(2)) {
    const pos = line.lastIndexOf(':');
    if (pos < 0) continue;
    const name = line.slice(0,pos).trim(), v = line.slice(pos+1).trim().split(/\s+/).map(Number);
    if (!name || v.length < 16 || v.some(n => !Number.isFinite(n))) continue;
    result.push({ name, rxBytes:v[0], rxPackets:v[1], rxErrors:v[2], rxDrops:v[3],
      txBytes:v[8], txPackets:v[9], txErrors:v[10], txDrops:v[11] });
  }
  return result;
}
function networkRates(previous, current, elapsed) {
  const old = new Map((previous || []).map(v => [v.name,v]));
  return current.map(v => {
    const p = old.get(v.name);
    const rate = key => p && elapsed > 0 && v[key]>=p[key]
      ? Math.round((v[key]-p[key])/elapsed) : null;
    return { ...v, rxPerSecond:rate('rxBytes'),txPerSecond:rate('txBytes') };
  });
}
function parseThermal(type, value, name) {
  const raw = Number(String(value).trim());
  const temp = Math.abs(raw)>=1000 ? raw/1000 : raw;
  return Number.isFinite(temp) && temp>=-40 && temp<=160
    ? { type:String(type||name).trim().slice(0,72),sensor:name,celsius:Math.round(temp*10)/10 } : null;
}
function parseWifi(text) {
  let value;
  try { value=JSON.parse(text); } catch { return { available:false,reason:'Termux:API ou permissão Wi-Fi indisponível' }; }
  if (!value || typeof value!=='object' || Array.isArray(value)) return { available:false,reason:'Wi-Fi indisponível' };
  const str = key => typeof value[key]==='string' ? value[key].slice(0,96) : null;
  const num = key => Number.isFinite(value[key]) ? value[key] : null;
  return { available:true, ssid:str('ssid'),ip:str('ip'),rssi:num('rssi'),
    linkSpeedMbps:num('link_speed_mbps'),frequencyMhz:num('frequency_mhz') };
}
function createSystemSampler({ clock=Date.now, fsRead=read, fsList=p=>fs.readdir(p).catch(()=>[]),
  run=command, termux=!!process.env.PREFIX?.includes('com.termux') } = {}) {
  let oldCpu=[], oldNet=[], last=0, hardware=null, hardwareAt=0, hardwarePending=null,
    wifi=null,wifiAt=0,wifiPending=null;
  const readSafe=p=>Promise.resolve().then(()=>fsRead(p)).catch(()=>null);
  async function getHardware() {
    if (!termux) return { available:false, reason:'Propriedades Android apenas no Termux' };
    if (hardware && clock()-hardwareAt<3600000) return hardware;
    if (hardwarePending) return hardwarePending;
    hardwarePending=(async()=>{
      const props=[['model','ro.product.model'],['manufacturer','ro.product.manufacturer'],
        ['android','ro.build.version.release'],['sdk','ro.build.version.sdk'],['device','ro.product.device']];
      const entries=await Promise.all(props.map(async ([key,prop])=>{
        try {const out=await run('/system/bin/getprop',[prop],2);return [key,out.ok ? out.text.slice(0,80)||null : null];}
        catch {return [key,null];}
      }));
      hardware={available:entries.some(([,v])=>v),...Object.fromEntries(entries)};
      hardwareAt=clock();return hardware;
    })().finally(()=>{hardwarePending=null;});
    return hardwarePending;
  }
  async function getWifi() {
    if (!termux) return {available:false,reason:'Wi-Fi requer Termux:API'};
    if (wifi && clock()-wifiAt<120000) return wifi;
    if (wifiPending) return wifiPending;
    wifiPending=(async()=>{
      try {const out=await run('termux-wifi-connectioninfo',[],5);
        wifi=out.ok ? parseWifi(out.text) : {available:false,reason:'Termux:API ou localização indisponível'};}
      catch {wifi={available:false,reason:'Termux:API não respondeu'};}
      wifiAt=clock();return wifi;
    })().finally(()=>{wifiPending=null;});
    return wifiPending;
  }
  async function sample() {
    const now=clock();
    const [cpuText,memText,netText,cpuPsi,memPsi,ioPsi,props,wlan,proc,zones]=await Promise.all([
      readSafe('/proc/stat'),readSafe('/proc/meminfo'),readSafe('/proc/net/dev'),
      readSafe('/proc/pressure/cpu'),readSafe('/proc/pressure/memory'),readSafe('/proc/pressure/io'),
      getHardware(),getWifi(),fsList('/proc'),fsList('/sys/class/thermal') ]);
    const cpuNow=parseCpu(cpuText), cpu=cpuUsage(oldCpu,cpuNow);
    const netNow=parseNetDev(netText), links=networkRates(oldNet,netNow,(now-last)/1000);
    if (cpuNow.length) oldCpu=cpuNow;
    if (netText) oldNet=netNow;
    last=now;
    const cores=cpu.filter(v=>v.core!=='total').slice(0,16);
    const [frequencies,thermal]=await Promise.all([
      Promise.all(cores.map(async core=>{
        const value=await readSafe('/sys/devices/system/cpu/'+core.core+'/cpufreq/scaling_cur_freq');
        const khz=Number(value?.trim());
        return {...core,frequencyMhz:value && Number.isFinite(khz) && khz>0 ? Math.round(khz/100)/10:null};
      })),
      Promise.all(zones.filter(v=>/^thermal_zone\d+$/.test(v)).slice(0,32).map(async name=>{
        const [type,temp]=await Promise.all([readSafe('/sys/class/thermal/'+name+'/type'),readSafe('/sys/class/thermal/'+name+'/temp')]);
        return temp==null?null:parseThermal(type,name?temp:null,name);
      }))
    ]);
    return {timestamp:new Date(now).toISOString(),
      device:{...props,hostname:os.hostname(),kernel:os.release(),architecture:os.arch(),
        node:process.version,visibleProcesses:proc.filter(v=>/^\d+$/.test(v)).length},
      cpu:{available:cpu.length>0,percent:cpu.find(v=>v.core==='total')?.percent??null,
        cores:frequencies,count:frequencies.length},
      memory:parseMemory(memText),
      pressure:{cpu:parsePressure(cpuPsi),memory:parsePressure(memPsi),io:parsePressure(ioPsi)},
      thermal:{available:thermal.some(Boolean),sensors:thermal.filter(Boolean)},
      interfaces:links.filter(v=>v.name!=='lo').slice(0,20),wifi:wlan };
  }
  return { sample };
}
const sampler=createSystemSampler();
module.exports={parseCpu,cpuUsage,parseMemory,parsePressure,parseNetDev,networkRates,parseThermal,parseWifi,
  createSystemSampler,readSystemTelemetry:()=>sampler.sample()};
