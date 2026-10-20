/* ============================================================
   LOOP — خادم محلي بسيط جدًا لتشغيل اللعبة أثناء التطوير
   بدون أي مكتبات. التشغيل:  node server.js
   ثم افتح: http://localhost:8000
   (للنشر الحقيقي لا تحتاج هذا الملف — ارفع الملفات لأي استضافة
    ثابتة مجانية مثل GitHub Pages أو Netlify)
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || process.argv[2] || 8000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(ROOT, urlPath);
    // منع الخروج خارج مجلد المشروع
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1 style="font-family:sans-serif">404 — الملف مش موجود 🎮 <a href="/">ارجع للعبة</a></h1>');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('🎮 LOOP شغال على http://localhost:' + PORT);
});
