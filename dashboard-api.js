"use strict";

const http = require("node:http");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://alfaddeavpefqobspvxt.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const DEFAULT_DASHBOARD_ORIGINS = ["https://onking1510u.netlify.app"];
const ALLOWED_ORIGINS = [...new Set([
  ...DEFAULT_DASHBOARD_ORIGINS,
  ...(process.env.DASHBOARD_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)
])];
const mutationWindows = new Map();

function sendJson(response, status, payload, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {})
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let rejected = false;
    request.on("data", chunk => {
      if (rejected) return;
      raw += chunk.toString("utf8");
      if (Buffer.byteLength(raw, "utf8") > 32 * 1024) {
        rejected = true;
        reject(Object.assign(new Error("คำขอมีขนาดใหญ่เกินไป"), { status: 413 }));
        request.resume();
      }
    });
    request.on("end", () => {
      if (rejected) return;
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("รูปแบบ JSON ไม่ถูกต้อง"), { status: 400 })); }
    });
    request.on("error", error => {
      if (!rejected) reject(error);
    });
  });
}

function enforceMutationLimit(request, userId) {
  const key = String(userId || request.socket.remoteAddress || "unknown");
  const now = Date.now();
  const current = mutationWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    mutationWindows.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > 10) {
    const error = new Error("ส่งคำสั่งถี่เกินไป กรุณารอสักครู่แล้วลองใหม่");
    error.status = 429;
    throw error;
  }
}

async function getAuthenticatedAdmin(request) {
  if (!SUPABASE_KEY) {
    const error = new Error("ยังไม่ได้ตั้งค่า Supabase publishable/anon key บน Hostrix");
    error.status = 503;
    throw error;
  }

  const match = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");
    error.status = 401;
    throw error;
  }

  const token = match[1];
  const userResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + token }
  });
  if (!userResponse.ok) {
    const error = new Error("เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่");
    error.status = 401;
    throw error;
  }

  const user = await userResponse.json();
  if (!user || !user.id) {
    const error = new Error("ไม่สามารถตรวจสอบบัญชีผู้ใช้ได้");
    error.status = 401;
    throw error;
  }

  const rolesUrl = new URL(SUPABASE_URL + "/rest/v1/user_roles");
  rolesUrl.searchParams.set("select", "role");
  rolesUrl.searchParams.set("user_id", "eq." + user.id);
  const rolesResponse = await fetch(rolesUrl, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + token }
  });
  if (!rolesResponse.ok) {
    const error = new Error("ตรวจสอบสิทธิ์ Owner/Admin จาก Supabase ไม่สำเร็จ");
    error.status = 403;
    throw error;
  }

  const roles = await rolesResponse.json();
  const roleNames = Array.isArray(roles) ? roles.map(item => String(item.role || "").toLowerCase()) : [];
  const role = roleNames.includes("owner") ? "owner" : roleNames.includes("admin") ? "admin" : "";
  if (!role) {
    const error = new Error("หน้านี้อนุญาตเฉพาะ Owner และ Admin เท่านั้น");
    error.status = 403;
    throw error;
  }
  return { user, role };
}

function getGuild(client, guildId) {
  if (!guildId) {
    const error = new Error("กรุณาระบุ guildId");
    error.status = 400;
    throw error;
  }
  const guild = client.guilds.cache.get(String(guildId));
  if (!guild) {
    const error = new Error("ไม่พบเซิร์ฟเวอร์ Discord นี้ หรือบอทยังไม่ได้เข้าร่วม");
    error.status = 404;
    throw error;
  }
  return guild;
}

async function handleRequest(request, response, client) {
  const requestUrl = new URL(request.url, "http://localhost");
  const origin = request.headers.origin || "";
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : "";

  if (origin && !allowedOrigin) return sendJson(response, 403, { error: "Origin นี้ไม่ได้รับอนุญาต" });
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin, "Vary": "Origin" } : {}),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600"
    });
    return response.end();
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    return sendJson(response, 200, {
      ok: true, api: "ON KING Dashboard API", discordReady: Boolean(client.isReady()),
      timestamp: new Date().toISOString()
    }, allowedOrigin);
  }

  try {
    const actor = await getAuthenticatedAdmin(request);

    if (request.method === "GET" && requestUrl.pathname === "/api/dashboard") {
      const guilds = [...client.guilds.cache.values()];
      const guildList = guilds.map(guild => ({
        id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }), memberCount: guild.memberCount || 0
      }));
      const online = Boolean(client.isReady() && client.user);
      return sendJson(response, 200, {
        ok: true,
        actorRole: actor.role,
        status: online ? "online" : "starting",
        bot: {
          online,
          status: online ? "online" : "starting",
          id: client.user ? client.user.id : null,
          username: client.user ? client.user.username : "ON KING BOT",
          tag: client.user ? client.user.tag : null,
          avatar: client.user ? client.user.displayAvatarURL({ size: 128 }) : null
        },
        guildCount: guilds.length,
        memberCount: guildList.reduce((total, guild) => total + guild.memberCount, 0),
        guilds: guildList
      }, allowedOrigin);
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/channels") {
      const guild = getGuild(client, requestUrl.searchParams.get("guildId"));
      await guild.channels.fetch().catch(() => null);
      const channels = [...guild.channels.cache.values()]
        .filter(channel => channel.isTextBased() && typeof channel.send === "function")
        .map(channel => ({ id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return sendJson(response, 200, { ok: true, channels }, allowedOrigin);
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/presence") {
      enforceMutationLimit(request, actor.user.id);
      const body = await readJson(request);
      if (!client.user || !client.isReady()) return sendJson(response, 503, { error: "บอทยังเชื่อมต่อ Discord ไม่สำเร็จ" }, allowedOrigin);

      const statuses = ["online", "idle", "dnd", "invisible"];
      const types = { watching: 3, playing: 0, listening: 2, competing: 5 };
      const status = statuses.includes(String(body.status || "").toLowerCase()) ? String(body.status).toLowerCase() : "online";
      const typeName = String(body.type || "watching").toLowerCase();
      const activityType = Object.prototype.hasOwnProperty.call(types, typeName) ? types[typeName] : types.watching;
      const activity = String(body.activity || body.name || "ON KING COMMUNITY").trim().slice(0, 128);
      client.user.setPresence({
        status,
        activities: activity ? [{ name: activity, type: activityType }] : []
      });
      return sendJson(response, 200, { ok: true, status, activity, type: typeName, message: "บันทึกสถานะบอทเรียบร้อยแล้ว" }, allowedOrigin);
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/message") {
      enforceMutationLimit(request, actor.user.id);
      const body = await readJson(request);
      if (!client.isReady()) return sendJson(response, 503, { error: "บอทยังเชื่อมต่อ Discord ไม่สำเร็จ" }, allowedOrigin);
      const guild = getGuild(client, body.guildId);
      const channel = await guild.channels.fetch(String(body.channelId || "")).catch(() => null);
      const message = String(body.message || body.content || "").trim();
      if (!channel || channel.guildId !== guild.id || !channel.isTextBased() || typeof channel.send !== "function") {
        return sendJson(response, 400, { error: "ไม่พบห้องข้อความที่เลือก" }, allowedOrigin);
      }
      if (!message || message.length > 2000) {
        return sendJson(response, 400, { error: "ข้อความต้องมี 1–2,000 ตัวอักษร" }, allowedOrigin);
      }
      const sent = await channel.send({ content: message, allowedMentions: { parse: [] } });
      return sendJson(response, 200, {
        ok: true, messageId: sent.id, channelId: channel.id, guildId: guild.id,
        message: "ส่งข้อความผ่าน ON KING BOT เรียบร้อยแล้ว"
      }, allowedOrigin);
    }

    return sendJson(response, 404, { error: "ไม่พบ API endpoint นี้" }, allowedOrigin);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error("ON KING Dashboard API:", error.message);
    return sendJson(response, status, { error: error.message || "เกิดข้อผิดพลาดใน Dashboard API" }, allowedOrigin);
  }
}

function startDashboardApi(client) {
  const server = http.createServer((request, response) => {
    handleRequest(request, response, client).catch(error => {
      console.error("Dashboard API request failed:", error.message);
      if (!response.headersSent) sendJson(response, 500, { error: "เกิดข้อผิดพลาดภายใน Dashboard API" });
      else response.end();
    });
  });
  server.on("error", error => console.error("เริ่ม ON KING Dashboard API ไม่สำเร็จ:", error.message));
  server.listen(PORT, "0.0.0.0", () => {
    console.log("ON KING Dashboard API listening on 0.0.0.0:" + PORT);
  });
  return server;
}

module.exports = { startDashboardApi };
