"use strict";
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const SETTINGS_FILE = path.join(process.cwd(), "on-king-card-settings.json");
function readSettings(guildId) {
  try { const all = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); return all[guildId] || {}; }
  catch { return {}; }
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;" }[c]));
}
function color(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback; }
async function avatarBuffer(user) {
  if (!user) return null;
  const url = user.displayAvatarURL({ extension: "png", size: 256 });
  const response = await fetch(url);
  if (!response.ok) throw new Error("ดาวน์โหลดรูปโปรไฟล์ Discord ไม่สำเร็จ");
  return Buffer.from(await response.arrayBuffer());
}
async function circleAvatar(buffer, size) {
  if (!buffer) return null;
  const circle = Buffer.from('<svg width="' + size + '" height="' + size + '" xmlns="http://www.w3.org/2000/svg"><circle cx="' + size/2 + '" cy="' + size/2 + '" r="' + (size/2-2) + '" fill="white"/></svg>');
  return sharp(buffer).resize(size, size, { fit: "cover" }).composite([{ input: circle, blend: "dest-in" }]).png().toBuffer();
}
function makeSvg(aName, bName, dateText, ended, cfg) {
  const bg1 = color(ended ? cfg.divorceBackground1 : cfg.coupleBackground1, ended ? "#160a12" : "#ff4f91");
  const bg2 = color(ended ? cfg.divorceBackground2 : cfg.coupleBackground2, ended ? "#08090e" : "#2b0922");
  const accent = color(cfg.accent, "#e8bd63");
  const title = esc(ended ? (cfg.divorceTitle || "ON KING DIVORCE") : (cfg.coupleTitle || "ON KING COUPLE"));
  const subtitle = esc(ended ? (cfg.divorceMessage || "สิ้นสุดความสัมพันธ์") : (cfg.coupleMessage || "เริ่มต้นความรักบทใหม่"));
  const footer = esc(ended ? (cfg.divorceFooter || "ขอบคุณทุกช่วงเวลาที่เคยมีร่วมกัน") : (cfg.coupleFooter || "ขอให้รักนี้อยู่เคียงข้างกันตลอดไป"));
  const date = esc(dateText);
  return Buffer.from(`<svg width="1536" height="512" viewBox="0 0 1536 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="${accent}" stop-opacity=".48"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff1b8"/><stop offset=".48" stop-color="${accent}"/><stop offset="1" stop-color="#8d5a1e"/></linearGradient>
    <filter id="shadow"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <rect width="1536" height="512" fill="url(#bg)"/>
  <circle cx="768" cy="245" r="360" fill="url(#glow)"/>
  <path d="M0 35 Q380 130 768 25 T1536 35 M0 480 Q380 380 768 490 T1536 480" fill="none" stroke="${accent}" stroke-width="3" opacity=".65"/>
  <path d="M18 18 H1518 V494 H18 Z" fill="none" stroke="url(#gold)" stroke-width="7"/>
  <path d="M34 34 H1502 V478 H34 Z" fill="none" stroke="${accent}" stroke-width="1.5" opacity=".65"/>
  <g fill="${accent}" opacity=".75"><path d="M768 22 l18 28 -18 28 -18 -28z"/><path d="M768 432 l18 28 -18 28 -18 -28z"/><circle cx="65" cy="256" r="5"/><circle cx="1471" cy="256" r="5"/></g>
  <g><circle cx="322" cy="230" r="137" fill="#050509" stroke="url(#gold)" stroke-width="12"/><circle cx="1214" cy="230" r="137" fill="#050509" stroke="url(#gold)" stroke-width="12"/><circle cx="322" cy="230" r="145" fill="none" stroke="${accent}" stroke-width="2"/><circle cx="1214" cy="230" r="145" fill="none" stroke="${accent}" stroke-width="2"/></g>
  <text x="768" y="92" text-anchor="middle" font-family="Georgia,serif" font-size="66" font-weight="bold" fill="url(#gold)" letter-spacing="5">ON KING</text>
  <text x="768" y="146" text-anchor="middle" font-family="Georgia,serif" font-size="42" font-style="italic" fill="#fff2f7">${title}</text>
  <text x="768" y="214" text-anchor="middle" font-family="Georgia,serif" font-size="82" fill="${ended ? "#ff526b" : "#ffe2ed"}">${ended ? "♡" : "∞"}</text>
  <rect x="500" y="282" width="536" height="72" rx="22" fill="#08070b" fill-opacity=".86" stroke="url(#gold)" stroke-width="4"/>
  <text x="768" y="326" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="bold" fill="#fff1d1">${subtitle}</text>
  <text x="768" y="389" text-anchor="middle" font-family="sans-serif" font-size="23" fill="#fff7e8">${date}</text>
  <text x="768" y="452" text-anchor="middle" font-family="sans-serif" font-size="25" font-weight="bold" fill="url(#gold)">${footer}</text>
  <text x="322" y="412" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#fff">${esc(aName)}</text>
  <text x="1214" y="412" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#fff">${esc(bName)}</text>
  <text x="768" y="492" text-anchor="middle" font-family="Georgia,serif" font-size="15" fill="${accent}" letter-spacing="4">ON KING COMMUNITY • CUPID</text>
  </svg>`);
}
async function renderRelationshipCard(client, relationship, ended = false) {
  const cfg = readSettings(relationship.guildId);
  const a = await client.users.fetch(relationship.user1).catch(() => null);
  const b = await client.users.fetch(relationship.user2).catch(() => null);
  const date = new Date(ended ? relationship.endedAt : relationship.createdAt);
  const dateText = date.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "long", timeStyle: "short" });
  const baseUrl = String(process.env.ONKING_CUPID_CARD_TEMPLATE_BASE_URL || "https://onking1510u.netlify.app/assets/cupid").replace(/\\/$/, "");
  const templateUrl = baseUrl + (ended ? "/on-king-divorce-card.png" : "/on-king-couple-card.png");
  let base;
  try {
    const response = await fetch(templateUrl);
    if (!response.ok) throw new Error("HTTP " + response.status);
    base = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.warn("ไม่สามารถโหลดภาพต้นแบบ CUPID ได้ ใช้พื้นหลังสำรอง:", error.message);
    base = await sharp(makeSvg(a?.username || "สมาชิก 1", b?.username || "สมาชิก 2", dateText, ended, cfg)).png().toBuffer();
  }
  const bg1 = color(ended ? cfg.divorceBackground1 : cfg.coupleBackground1, ended ? "#160a12" : "#ff4f91");
  const bg2 = color(ended ? cfg.divorceBackground2 : cfg.coupleBackground2, ended ? "#08090e" : "#2b0922");
  const accent = color(cfg.accent, "#e8bd63");
  const title = esc(ended ? (cfg.divorceTitle || "Divorce") : (cfg.coupleTitle || "Couple"));
  const message = esc(ended ? (cfg.divorceMessage || "สิ้นสุดความสัมพันธ์") : (cfg.coupleMessage || "เริ่มคบกันเมื่อ"));
  const footer = esc(ended ? (cfg.divorceFooter || "ขอบคุณทุกช่วงเวลาที่เคยมีร่วมกัน") : (cfg.coupleFooter || "ขอให้รักนี้อยู่เคียงข้างกันตลอดไป"));
  const tint = Buffer.from(`<svg width="1536" height="512" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${bg1}" stop-opacity=".25"/><stop offset="1" stop-color="${bg2}" stop-opacity=".30"/></linearGradient></defs><rect width="1536" height="512" fill="url(#t)"/></svg>`);
  const overlay = Buffer.from(`<svg width="1536" height="512" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="shadow"><feGaussianBlur stdDeviation="3"/></filter></defs>
    <rect x="600" y="112" width="336" height="88" rx="24" fill="#10070d" fill-opacity=".35"/>
    <text x="768" y="177" text-anchor="middle" font-family="Georgia,serif" font-size="54" font-style="italic" font-weight="bold" fill="${accent}" stroke="#210b16" stroke-width="1">${title}</text>
    <rect x="586" y="344" width="364" height="43" rx="12" fill="#08060a" fill-opacity=".88" stroke="${accent}" stroke-width="2"/>
    <text x="768" y="374" text-anchor="middle" font-family="sans-serif" font-size="23" font-weight="bold" fill="#fff1d1">${message}</text>
    <rect x="574" y="392" width="388" height="39" rx="10" fill="#08060a" fill-opacity=".90" stroke="${accent}" stroke-width="1.5"/>
    <text x="768" y="418" text-anchor="middle" font-family="sans-serif" font-size="19" font-weight="bold" fill="#fff">${esc(dateText)}</text>
    <text x="322" y="402" text-anchor="middle" font-family="sans-serif" font-size="25" font-weight="bold" fill="#fff" stroke="#190811" stroke-width="1">${esc(a?.globalName || a?.username || "สมาชิก 1")}</text>
    <text x="1214" y="402" text-anchor="middle" font-family="sans-serif" font-size="25" font-weight="bold" fill="#fff" stroke="#190811" stroke-width="1">${esc(b?.globalName || b?.username || "สมาชิก 2")}</text>
    <rect x="470" y="454" width="596" height="42" rx="12" fill="#08060a" fill-opacity=".78"/>
    <text x="768" y="483" text-anchor="middle" font-family="sans-serif" font-size="23" font-weight="bold" fill="${accent}">${footer}</text>
  </svg>`);
  const layers = [{ input: base }, { input: tint, blend: "soft-light" }, { input: overlay }];
  const avatarSize = 244;
  const left = await avatarBuffer(a), right = await avatarBuffer(b);
  if (left) layers.push({ input: await circleAvatar(left, avatarSize), left: 200, top: 98 });
  if (right) layers.push({ input: await circleAvatar(right, avatarSize), left: 1092, top: 98 });
  return sharp({ create: { width: 1536, height: 512, channels: 4, background: "#08080a" } }).composite(layers).png().toBuffer();
}
module.exports = { renderRelationshipCard, readSettings };
