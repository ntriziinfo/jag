const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;

const machines = new Map();
const adminClients = new Set();
const commandClients = new Map();

function sendJson(res, status, data){
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function readBody(req){
  return new Promise((resolve, reject)=>{
    let body = "";
    req.on("data", chunk=>{
      body += chunk;
      if(body.length > 1024 * 1024) {
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
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  res.write(": connected\n\n");
}

function sseSend(res, event, data){
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastMachines(){
  const payload = [...machines.values()].sort((a,b)=>String(a.machineId).localeCompare(String(b.machineId)));
  for(const res of adminClients) sseSend(res, "machines", payload);
}

function sendCommand(machineId, command){
  const clients = commandClients.get(machineId);
  if(!clients || !clients.size) return false;
  for(const res of clients) sseSend(res, "command", command);
  return true;
}

function serveFile(res, pathname){
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
      ".png":"image/png",
      ".webp":"image/webp",
      ".jpg":"image/jpeg",
      ".jpeg":"image/jpeg",
      ".mp3":"audio/mpeg",
      ".wav":"audio/wav",
      ".mp4":"video/mp4"
    };
    res.writeHead(200, {"Content-Type": types[ext] || "application/octet-stream"});
    res.end(data);
  });
}

const server = http.createServer(async (req, res)=>{
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if(req.method === "OPTIONS") return sendJson(res, 204, {});

  try{
    if(url.pathname === "/api/machines" && req.method === "GET"){
      return sendJson(res, 200, [...machines.values()]);
    }

    if(url.pathname === "/api/events" && req.method === "GET"){
      sseHeaders(res);
      adminClients.add(res);
      sseSend(res, "machines", [...machines.values()]);
      req.on("close", ()=>adminClients.delete(res));
      return;
    }

    const stateMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/state$/);
    if(stateMatch && req.method === "POST"){
      const machineId = decodeURIComponent(stateMatch[1]);
      const body = await readBody(req);
      const previous = machines.get(machineId) || {};
      machines.set(machineId, {
        ...previous,
        ...body,
        machineId,
        online: true,
        updatedAt: Date.now()
      });
      broadcastMachines();
      return sendJson(res, 200, {ok:true});
    }

    const commandStreamMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/commands$/);
    if(commandStreamMatch && req.method === "GET"){
      const machineId = decodeURIComponent(commandStreamMatch[1]);
      sseHeaders(res);
      if(!commandClients.has(machineId)) commandClients.set(machineId, new Set());
      commandClients.get(machineId).add(res);
      req.on("close", ()=>{
        const clients = commandClients.get(machineId);
        if(clients) clients.delete(res);
      });
      return;
    }

    const commandMatch = url.pathname.match(/^\/api\/machines\/([^/]+)\/command$/);
    if(commandMatch && req.method === "POST"){
      const machineId = decodeURIComponent(commandMatch[1]);
      const command = await readBody(req);
      const delivered = sendCommand(machineId, {...command, id: `${Date.now()}-${Math.random().toString(16).slice(2)}`});
      return sendJson(res, 200, {ok:true, delivered});
    }

    if(url.pathname === "/api/command-all" && req.method === "POST"){
      const command = await readBody(req);
      let delivered = 0;
      for(const machineId of machines.keys()){
        if(sendCommand(machineId, {...command, id: `${Date.now()}-${Math.random().toString(16).slice(2)}`})) delivered++;
      }
      return sendJson(res, 200, {ok:true, delivered});
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
    const online = now - machine.updatedAt < 15000;
    if(machine.online !== online){
      machine.online = online;
      changed = true;
    }
  }
  if(changed) broadcastMachines();
}, 3000);

server.listen(PORT, ()=>{
  console.log(`White Devil admin server`);
  console.log(`Slot:  http://localhost:${PORT}/?machine=台1`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
});
