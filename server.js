const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const {machineTotalFor} = require("./machine-totals.cjs");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "admin-state.json");
const RESULTS_FILE = path.join(DATA_DIR, "session-results.jsonl");
const SHEETS_WEBHOOK_URL = String(process.env.GOOGLE_SHEETS_WEBHOOK_URL || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const MACHINE_COUNT = 6;
const DEBUG_MACHINE_ID = "debug";

const machines = new Map();
const adminClients = new Set();
const commandClients = new Map();

function isDebugMachine(id){ return String(id) === DEBUG_MACHINE_ID; }
function machineLabel(id){ return isDebugMachine(id) ? "確認台" : `${id}号機`; }
function emptyMachine(id){
  return {
    machineId:String(id),
    displayName:machineLabel(id),
    online:false,
    locked:false,
    resetSerial:0,
    currentSessionId:"",
    currentPlayerName:"",
    lastSnapshot:null,
    lastEndedSession:null,
    updatedAt:0
  };
}

let state = {
  version:1,
  machines:{},
  issuedPasswords:{},
  sessions:{},
  commands:[],
  updatedAt:Date.now()
};

function ensureDataDir(){ fs.mkdirSync(DATA_DIR, {recursive:true}); }

function loadState(){
  ensureDataDir();
  try{
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    state = {...state, ...parsed, machines:parsed.machines || {}, issuedPasswords:parsed.issuedPasswords || {}, sessions:parsed.sessions || {}, commands:Array.isArray(parsed.commands) ? parsed.commands : []};
  }catch(e){}
  for(let i=1;i<=MACHINE_COUNT;i++){
    const id = String(i);
    state.machines[id] = {...emptyMachine(id), ...(state.machines[id] || {})};
    machines.set(id, state.machines[id]);
  }
  state.machines[DEBUG_MACHINE_ID] = {...emptyMachine(DEBUG_MACHINE_ID), ...(state.machines[DEBUG_MACHINE_ID] || {})};
  machines.set(DEBUG_MACHINE_ID, state.machines[DEBUG_MACHINE_ID]);
}

function saveState(){
  ensureDataDir();
  state.updatedAt = Date.now();
  const serializable = {...state, machines:{}};
  for(const [id, machine] of machines.entries()) serializable.machines[id] = machine;
  fs.writeFileSync(STATE_FILE, JSON.stringify(serializable, null, 2));
}

function adminOk(req){
  if(!ADMIN_PASSWORD) return true;
  const provided = req.headers["x-admin-password"] || "";
  return String(provided) === ADMIN_PASSWORD;
}

function sendJson(res, status, data){
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type":"application/json; charset=utf-8",
    "Content-Length":Buffer.byteLength(body),
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type,X-Admin-Password"
  });
  res.end(body);
}

function readBody(req){
  return new Promise((resolve, reject)=>{
    let body = "";
    req.on("data", chunk=>{
      body += chunk;
      if(body.length > 1024 * 1024 * 4){
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", ()=>{
      try{ resolve(body ? JSON.parse(body) : {}); }
      catch(e){ reject(e); }
    });
    req.on("error", reject);
  });
}

function sseHeaders(res){
  res.writeHead(200, {
    "Content-Type":"text/event-stream; charset=utf-8",
    "Cache-Control":"no-cache, no-transform",
    "Connection":"keep-alive",
    "Access-Control-Allow-Origin":"*"
  });
  res.write(": connected\n\n");
}

function sseSend(res, event, data){
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function publicMachine(machine, machineTotal){
  const snapshot = machine.lastSnapshot || null;
  const stats = snapshot && snapshot.stats ? snapshot.stats : null;
  return {
    machineId:machine.machineId,
    displayName:machine.displayName || (String(machine.machineId) === DEBUG_MACHINE_ID ? "確認台" : `${machine.machineId}号機`),
    online:!!machine.online,
    locked:!!machine.locked,
    currentSessionId:machine.currentSessionId || "",
    currentPlayerName:machine.currentPlayerName || "",
    updatedAt:machine.updatedAt || 0,
    resetSerial:machine.resetSerial || 0,
    assignedSetting:machine.assignedSetting || (stats && stats.setting) || (snapshot && snapshot.settings ? snapshot.settings.setting : 1),
    lastEndedSession:machine.lastEndedSession || null,
    playSessionId:snapshot && snapshot.playSessionId || "",
    playSessionStartStats:snapshot && snapshot.playSessionStartStats || null,
    stats,
    slumpHistory:stats && Array.isArray(stats.slumpHistory) ? stats.slumpHistory : [{spin:0, profit:0}],
    machineTotalStats:machineTotal.stats,
    machineTotalSlumpHistory:machineTotal.history
  };
}

function allMachines(){
  return [...machines.values()].sort((a,b)=>{
    if(String(a.machineId) === DEBUG_MACHINE_ID) return 1;
    if(String(b.machineId) === DEBUG_MACHINE_ID) return -1;
    return Number(a.machineId)-Number(b.machineId);
  });
}

function publicMachines(){
  const records = readResultRecords(1000);
  return allMachines().map(machine=>publicMachine(machine, machineTotalFor(machine, records)));
}

function broadcastMachines(){
  const payload = publicMachines();
  for(const res of adminClients) sseSend(res, "machines", payload);
}

function queueCommand(machineId, command){
  const id = Date.now() * 1000 + crypto.randomInt(0, 1000);
  const row = {id, machineId:String(machineId), command:{...command, id}, createdAtMs:Date.now()};
  state.commands = Array.isArray(state.commands) ? state.commands : [];
  state.commands.push(row);
  state.commands = state.commands.slice(-500);
  return row;
}

function sendCommand(machineId, command){
  const row = queueCommand(machineId, command);
  saveState();
  const clients = commandClients.get(String(machineId));
  if(clients && clients.size){
    for(const res of clients) sseSend(res, "command", row.command);
  }
  return !!(clients && clients.size);
}

function generatePassword(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for(let i=0;i<6;i++) value += alphabet[crypto.randomInt(0, alphabet.length)];
  return value;
}

function makeId(prefix){
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function machineFor(id){
  const machineId = String(id || "");
  if(!machines.has(machineId)) return null;
  return machines.get(machineId);
}

function appendResult(record){
  ensureDataDir();
  fs.appendFileSync(RESULTS_FILE, JSON.stringify(record) + "\n");
}

function hasResetSerial(record){
  return record && record.resetSerial !== undefined && record.resetSerial !== null && record.resetSerial !== "";
}

function restoreResultResetSerial(record){
  if(hasResetSerial(record)) return record;
  const session = state.sessions[String(record && record.sessionId || "")];
  if(!session || session.resetSerialAtStart === undefined || session.resetSerialAtStart === null) return record;
  return {...record, resetSerial:Number(session.resetSerialAtStart) || 0};
}

function readResultRecords(limit=200){
  let rows = [];
  try{
    rows = fs.readFileSync(RESULTS_FILE, "utf8").split(/\n+/).filter(Boolean).map(line=>JSON.parse(line));
  }catch(e){}
  return rows.slice(-Math.max(1, Number(limit) || 200)).reverse().map(restoreResultResetSerial);
}

function postJson(urlString, payload){
  return new Promise((resolve, reject)=>{
    if(!urlString) return resolve({skipped:true});
    const target = new URL(urlString);
    const body = JSON.stringify(payload);
    const lib = target.protocol === "http:" ? http : https;
    const req = lib.request(target, {
      method:"POST",
      headers:{"Content-Type":"application/json", "Content-Length":Buffer.byteLength(body)}
    }, res=>{
      let text = "";
      res.on("data", chunk=>text += chunk);
      res.on("end", ()=>resolve({status:res.statusCode, body:text}));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function numberStat(stats, key){ return Number(stats && stats[key] || 0) || 0; }
function sessionStartStats(session, snapshot){
  const clientStartStats = snapshot && snapshot.playSessionStartStats;
  const clientSessionId = String(snapshot && snapshot.playSessionId || "");
  const expectedSessionId = String(session && session.sessionId || "");
  if(clientStartStats && typeof clientStartStats === "object" && clientSessionId && clientSessionId === expectedSessionId){
    return {stats:clientStartStats, source:"client-session-start"};
  }
  return {stats:{}, source:"server-session-zero"};
}
function snapshotForSession(session, machine, submittedSnapshot=null){
  const expectedSessionId = String(session && session.sessionId || "");
  for(const snapshot of [submittedSnapshot, machine && machine.lastSnapshot]){
    if(snapshot && String(snapshot.playSessionId || "") === expectedSessionId) return snapshot;
  }
  return {playSessionId:expectedSessionId, playSessionStartStats:{}, stats:{}};
}
function sessionDelta(session, snapshot){
  const baseline = sessionStartStats(session, snapshot);
  const endStats = snapshot && snapshot.stats ? snapshot.stats : {};
  const countersReset = numberStat(endStats, "totalSpins") < numberStat(baseline.stats, "totalSpins")
    || numberStat(endStats, "totalFee") < numberStat(baseline.stats, "totalFee")
    || numberStat(endStats, "totalPaid") < numberStat(baseline.stats, "totalPaid");
  const startStats = countersReset ? {} : baseline.stats;
  const playerTotalFee = Math.max(0, numberStat(endStats, "totalFee") - numberStat(startStats, "totalFee"));
  const playerTotalPaid = Math.max(0, numberStat(endStats, "totalPaid") - numberStat(startStats, "totalPaid"));
  const playerSpins = Math.max(0, numberStat(endStats, "totalSpins") - numberStat(startStats, "totalSpins"));
  const playerBigCount = Math.max(0, numberStat(endStats, "bigCount") - numberStat(startStats, "bigCount"));
  const playerRegCount = Math.max(0, numberStat(endStats, "midCount") - numberStat(startStats, "midCount"));
  const playerGrapeCount = Math.max(0, numberStat(endStats, "grapeCount") - numberStat(startStats, "grapeCount"));
  const playerProfit = playerTotalPaid - playerTotalFee;
  return {playerTotalFee, playerTotalPaid, playerProfit, playerSpins, playerBigCount, playerRegCount, playerGrapeCount, startStats, baselineSource:countersReset ? baseline.source + "-counter-reset" : baseline.source};
}

async function sendToSheets(record){
  if(!SHEETS_WEBHOOK_URL) return {ok:false, skipped:true, reason:"GOOGLE_SHEETS_WEBHOOK_URL is not set"};
  try{
    const result = await postJson(SHEETS_WEBHOOK_URL, record);
    return {ok:true, result};
  }catch(e){
    return {ok:false, error:e.message};
  }
}

function resultPayload(session, machine, body){
  const snapshot = body.snapshot || machine.lastSnapshot || {};
  const stats = snapshot.stats || {};
  const settings = snapshot.settings || {};
  const delta = sessionDelta(session, snapshot);
  const now = Date.now();
  return {
    type:"slot-session-ended",
    endedAt:new Date(now).toISOString(),
    endedAtMs:now,
    machineId:machine.machineId,
    machineName:machine.displayName || (String(machine.machineId) === DEBUG_MACHINE_ID ? "確認台" : `${machine.machineId}号機`),
    playerName:session.playerName || body.playerName || "",
    sessionId:session.sessionId,
    password:session.password,
    resetSerial:Number(session.resetSerialAtStart ?? machine.resetSerial) || 0,
    setting:settings.setting || "",
    totalSpins:stats.totalSpins || 0,
    bigCount:stats.bigCount || 0,
    regCount:stats.midCount || 0,
    grapeCount:stats.grapeCount || 0,
    totalFee:stats.totalFee || 0,
    totalPaid:stats.totalPaid || 0,
    profit:Number(stats.profit ?? ((stats.totalPaid || 0) - (stats.totalFee || 0))) || 0,
    playerSpins:delta.playerSpins,
    playerBigCount:delta.playerBigCount,
    playerRegCount:delta.playerRegCount,
    playerGrapeCount:delta.playerGrapeCount,
    playerTotalFee:delta.playerTotalFee,
    playerTotalPaid:delta.playerTotalPaid,
    playerProfit:delta.playerProfit,
    billingBasis:"playerProfit",
    playerBaselineSource:delta.baselineSource,
    startStats:delta.startStats,
    currentResultText:snapshot.state ? snapshot.state.resultText || "" : "",
    stats,
    settings,
    normalState:snapshot.normalState || {},
    session:snapshot.session || {}
  };
}

function serveFile(res, pathname){
  if(pathname === "/jag" || pathname === "/jag/"){
    res.writeHead(302, {"Location":"/jag.html"});
    res.end();
    return;
  }
  if(pathname === "/gorai.html" || pathname === "/gourai.html" || pathname === "/gorai_complete_test.html"){
    res.writeHead(302, {"Location":"/jag.html"});
    res.end();
    return;
  }
  const clean = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, clean));
  if(!filePath.startsWith(ROOT)){
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data)=>{
    if(err){
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html":"text/html; charset=utf-8",
      ".js":"text/javascript; charset=utf-8",
      ".css":"text/css; charset=utf-8",
      ".svg":"image/svg+xml",
      ".png":"image/png",
      ".webp":"image/webp",
      ".jpg":"image/jpeg",
      ".jpeg":"image/jpeg",
      ".mp3":"audio/mpeg",
      ".wav":"audio/wav",
      ".mp4":"video/mp4"
    };
    res.writeHead(200, {"Content-Type":types[ext] || "application/octet-stream"});
    res.end(data);
  });
}

loadState();

const server = http.createServer(async (req, res)=>{
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if(req.method === "OPTIONS") return sendJson(res, 204, {});

  try{
    if(url.pathname === "/api/machines" && req.method === "GET"){
      return sendJson(res, 200, publicMachines());
    }

    if(url.pathname === "/api/events" && req.method === "GET"){
      sseHeaders(res);
      adminClients.add(res);
      sseSend(res, "machines", publicMachines());
      req.on("close", ()=>adminClients.delete(res));
      return;
    }

    if(url.pathname === "/api/admin/issue-password" && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const body = await readBody(req);
      const machine = machineFor(body.machineId);
      if(!machine) return sendJson(res, 400, {ok:false, error:"invalid machine"});
      const playerName = String(body.playerName || "").trim();
      if(!playerName) return sendJson(res, 400, {ok:false, error:"playerName required"});
      const password = generatePassword();
      const issued = {
        password,
        machineId:machine.machineId,
        playerName,
        status:"issued",
        issuedAt:Date.now(),
        usedAt:0,
        sessionId:""
      };
      state.issuedPasswords[password] = issued;
      saveState();
      return sendJson(res, 200, {ok:true, issued});
    }

    if(url.pathname === "/api/admin/passwords" && req.method === "GET"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const items = Object.values(state.issuedPasswords).sort((a,b)=>(b.issuedAt || 0) - (a.issuedAt || 0)).slice(0, 80);
      return sendJson(res, 200, items);
    }

    if(url.pathname === "/api/sessions/start" && req.method === "POST"){
      const body = await readBody(req);
      const password = String(body.password || "").trim().toUpperCase();
      const requestedMachineId = String(body.requestedMachineId || "").trim();
      const issued = state.issuedPasswords[password];
      if(!issued) return sendJson(res, 403, {ok:false, error:"password not found"});
      if(requestedMachineId && requestedMachineId !== String(issued.machineId)){
        return sendJson(res, 403, {ok:false, error:"このパスワードは別の台用です"});
      }
      const machine = machineFor(issued.machineId);
      if(!machine) return sendJson(res, 400, {ok:false, error:"machine not found"});
      const existingSession = issued.sessionId ? state.sessions[issued.sessionId] : null;
      const iframeUrlFor = sessionId=>`/jag.html?machine=${encodeURIComponent(machine.machineId)}&server=${encodeURIComponent(url.origin)}&creditBaseline=0&playSessionId=${encodeURIComponent(String(sessionId || ""))}`;
      if(issued.status === "used" && existingSession && existingSession.status === "active"){
        return sendJson(res, 200, {
          ok:true,
          resumed:true,
          session:{sessionId:existingSession.sessionId, token:existingSession.token, machineId:machine.machineId, playerName:existingSession.playerName},
          iframeUrl:iframeUrlFor(existingSession.sessionId)
        });
      }
      if(issued.status !== "issued") return sendJson(res, 403, {ok:false, error:"このパスワードは終了済みです"});
      if(machine.currentSessionId && machine.currentSessionId !== (existingSession && existingSession.sessionId)) return sendJson(res, 409, {ok:false, error:"machine is busy"});
      const sessionId = makeId("sess");
      const token = crypto.randomBytes(16).toString("hex");
      const session = {
        sessionId,
        token,
        password,
        machineId:machine.machineId,
        playerName:issued.playerName,
        status:"active",
        startedAt:Date.now(),
        endedAt:0,
        resetSerialAtStart:machine.resetSerial || 0,
        startSnapshot:machine.lastSnapshot || null
      };
      issued.status = "used";
      issued.usedAt = Date.now();
      issued.sessionId = sessionId;
      state.sessions[sessionId] = session;
      machine.locked = true;
      machine.currentSessionId = sessionId;
      machine.currentPlayerName = session.playerName;
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, session:{sessionId, token, machineId:machine.machineId, playerName:session.playerName}, iframeUrl:iframeUrlFor(sessionId)});
    }

    if(url.pathname === "/api/sessions/end" && req.method === "POST"){
      const body = await readBody(req);
      const session = state.sessions[String(body.sessionId || "")];
      if(!session || session.token !== String(body.token || "")) return sendJson(res, 403, {ok:false, error:"invalid session"});
      if(session.status === "ended") return sendJson(res, 200, {ok:true, alreadyEnded:true, record:session.resultRecord || null});
      const machine = machineFor(session.machineId);
      if(!machine) return sendJson(res, 400, {ok:false, error:"machine not found"});
      const snapshot = snapshotForSession(session, machine, body.snapshot);
      if(body.snapshot && snapshot === body.snapshot) machine.lastSnapshot = snapshot;
      const record = resultPayload(session, machine, {...body, snapshot});
      appendResult(record);
      const sheets = await sendToSheets(record);
      session.status = "ended";
      session.endedAt = Date.now();
      session.resultRecord = record;
      session.sheets = sheets;
      machine.locked = false;
      machine.currentSessionId = "";
      machine.currentPlayerName = "";
      machine.lastEndedSession = {sessionId:session.sessionId, playerName:session.playerName, endedAt:session.endedAt, record, sheets};
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, record, sheets});
    }

    const forceEndMatch = url.pathname.match(/^\/api\/admin\/machines\/([^/]+)\/force-end$/);
    if(forceEndMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const machine = machineFor(decodeURIComponent(forceEndMatch[1]));
      if(!machine) return sendJson(res, 404, {ok:false, error:"machine not found"});
      const session = machine.currentSessionId ? state.sessions[machine.currentSessionId] : null;
      if(session && session.status === "active"){
        const record = {...resultPayload(session, machine, {snapshot:snapshotForSession(session, machine)}), forced:true, forcedBy:"admin"};
        appendResult(record);
        const sheets = await sendToSheets(record);
        session.status = "ended";
        session.endedAt = Date.now();
        session.resultRecord = record;
        session.sheets = sheets;
        machine.locked = false;
        machine.currentSessionId = "";
        machine.currentPlayerName = "";
        machine.lastEndedSession = {sessionId:session.sessionId, playerName:session.playerName, endedAt:session.endedAt, record, sheets, forced:true};
        saveState();
        broadcastMachines();
        return sendJson(res, 200, {ok:true, forced:true, record, sheets});
      }
      if(machine.lastEndedSession){
        machine.locked = false;
        machine.currentSessionId = "";
        machine.currentPlayerName = "";
        saveState();
        broadcastMachines();
        return sendJson(res, 200, {ok:true, released:true, alreadyEnded:true, record:machine.lastEndedSession.record || null, sheets:machine.lastEndedSession.sheets || null});
      }
      if(!session && !machine.lastSnapshot) return sendJson(res, 400, {ok:false, error:"終了できるデータがありません"});
      const forcedSession = {
        sessionId:makeId("forced"),
        token:"",
        password:"",
        machineId:machine.machineId,
        playerName:machine.currentPlayerName || "強制終了",
        status:"active",
        startedAt:0,
        endedAt:0,
        startSnapshot:machine.lastSnapshot || null
      };
      const record = {...resultPayload(forcedSession, machine, {}), forced:true, forcedBy:"admin"};
      appendResult(record);
      const sheets = await sendToSheets(record);
      machine.locked = false;
      machine.currentSessionId = "";
      machine.currentPlayerName = "";
      machine.lastEndedSession = {sessionId:forcedSession.sessionId, playerName:forcedSession.playerName, endedAt:Date.now(), record, sheets, forced:true};
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, record, sheets});
    }

    const resetMatch = url.pathname.match(/^\/api\/admin\/machines\/([^/]+)\/reset$/);
    if(resetMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const machine = machineFor(decodeURIComponent(resetMatch[1]));
      if(!machine) return sendJson(res, 404, {ok:false, error:"machine not found"});
      machine.locked = false;
      machine.currentSessionId = "";
      machine.currentPlayerName = "";
      machine.lastEndedSession = null;
      machine.lastSnapshot = null;
      machine.resetSerial = (Number(machine.resetSerial) || 0) + 1;
      const delivered = sendCommand(machine.machineId, {type:"reset", reason:"admin-reset", id:makeId("cmd")});
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, delivered});
    }

    const stateMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/state$/);
    if(stateMatch && req.method === "POST"){
      const machineId = decodeURIComponent(stateMatch[1]);
      const machine = machineFor(machineId) || emptyMachine(machineId);
      const body = await readBody(req);
      const incomingSessionId = String(body.playSessionId || "");
      if(incomingSessionId && incomingSessionId !== String(machine.currentSessionId || "")){
        return sendJson(res, 200, {ok:true, ignored:true, reason:"stale play session"});
      }
      const snapshot = {...body, machineId, online:true, updatedAt:Date.now()};
      machine.lastSnapshot = snapshot;
      machine.displayName = body.name || machine.displayName || `${machineId}号機`;
      machine.online = true;
      machine.updatedAt = Date.now();
      machines.set(machineId, machine);
      state.machines[machineId] = machine;
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true});
    }

    const commandPollMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/commands\/poll$/);
    if(commandPollMatch && req.method === "GET"){
      const machineId = decodeURIComponent(commandPollMatch[1]);
      const since = Number(url.searchParams.get("since") || 0) || 0;
      const commands = (Array.isArray(state.commands) ? state.commands : []).filter(row=>String(row.machineId) === String(machineId) && Number(row.id) > since).slice(-25);
      return sendJson(res, 200, {ok:true, commands});
    }

    const commandStreamMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/commands$/);
    if(commandStreamMatch && req.method === "GET"){
      const machineId = decodeURIComponent(commandStreamMatch[1]);
      sseHeaders(res);
      if(!commandClients.has(machineId)) commandClients.set(machineId, new Set());
      commandClients.get(machineId).add(res);
      const connectedMachine = machineFor(machineId);
      if(connectedMachine && connectedMachine.assignedSetting){
        const currentSettings = connectedMachine.lastSnapshot && connectedMachine.lastSnapshot.settings ? connectedMachine.lastSnapshot.settings : {};
        sseSend(res, "command", {type:"applySettings", settings:{...currentSettings, setting:connectedMachine.assignedSetting}, id:makeId("cmd")});
      }
      req.on("close", ()=>{
        const clients = commandClients.get(machineId);
        if(clients) clients.delete(res);
      });
      return;
    }

    const adminSettingMatch = url.pathname.match(/^\/api\/admin\/machines\/([^/]+)\/setting$/);
    if(adminSettingMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const machine = machineFor(decodeURIComponent(adminSettingMatch[1]));
      if(!machine) return sendJson(res, 404, {ok:false, error:"machine not found"});
      const body = await readBody(req);
      const setting = Math.max(1, Math.min(6, Math.round(Number(body.setting) || 1)));
      const currentSettings = machine.lastSnapshot && machine.lastSnapshot.settings ? machine.lastSnapshot.settings : {};
      const settings = {...currentSettings, setting};
      machine.assignedSetting = setting;
      machine.lastSnapshot = machine.lastSnapshot || {machineId:machine.machineId, stats:{}, settings:{}, updatedAt:Date.now()};
      machine.lastSnapshot.settings = settings;
      machine.lastSnapshot.updatedAt = Date.now();
      const delivered = sendCommand(machine.machineId, {type:"applySettings", settings, id:makeId("cmd")});
      saveState();
      broadcastMachines();
      return sendJson(res, 200, {ok:true, setting, delivered});
    }

    const commandMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/command$/);
    if(commandMatch && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const machineId = decodeURIComponent(commandMatch[1]);
      const command = await readBody(req);
      const delivered = sendCommand(machineId, {...command, id:makeId("cmd")});
      return sendJson(res, 200, {ok:true, delivered});
    }

    if(url.pathname === "/api/command-all" && req.method === "POST"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      const command = await readBody(req);
      let delivered = 0;
      for(const machineId of machines.keys()){
        if(sendCommand(machineId, {...command, id:makeId("cmd")})) delivered++;
      }
      return sendJson(res, 200, {ok:true, delivered});
    }

    if(url.pathname === "/api/results" && req.method === "GET"){
      if(!adminOk(req)) return sendJson(res, 401, {ok:false, error:"admin password required"});
      return sendJson(res, 200, readResultRecords(200));
    }

    return serveFile(res, url.pathname);
  }catch(e){
    return sendJson(res, 500, {ok:false, error:e.message});
  }
});

setInterval(()=>{
  const now = Date.now();
  let changed = false;
  for(const machine of machines.values()){
    const online = now - (machine.updatedAt || 0) < 15000;
    if(machine.online !== online){
      machine.online = online;
      changed = true;
    }
  }
  if(changed){
    saveState();
    broadcastMachines();
  }
}, 3000);

server.listen(PORT, ()=>{
  console.log("RISING operations server");
  console.log(`Admin:   http://localhost:${PORT}/admin.html`);
  console.log(`Play:    http://localhost:${PORT}/play.html`);
  console.log(`Machines:http://localhost:${PORT}/machines.html`);
});
