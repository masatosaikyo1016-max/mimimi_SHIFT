const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, "shifts-data.json");

// 専用URLのアクセストークン（環境変数 ACCESS_KEY で上書き可能）
const ACCESS_KEY = process.env.ACCESS_KEY || "hhgt_8x9k2m4p7w3q";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// 保存データの読み込み
function readShiftsData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.shifts)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("データ読み込みエラー:", e);
  }
  return { shifts: [], updatedAt: new Date().toISOString() };
}

// 保存データの書き込み
function writeShiftsData(shifts) {
  const payload = {
    shifts: Array.isArray(shifts) ? shifts : [],
    updatedAt: new Date().toISOString()
  };
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    console.error("データ保存エラー:", e);
  }
  return payload;
}

const server = http.createServer((req, res) => {
  // 検索エンジン除けヘッダーを全レスポンスに付与
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // --- API: シフトデータの取得・保存 ---
  if (pathname === "/api/shifts") {
    const reqKey = req.headers["x-access-key"] || parsedUrl.searchParams.get("key");
    if (reqKey !== ACCESS_KEY) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "専用URLのアクセスキーが無効です" }));
      return;
    }

    if (req.method === "GET") {
      const data = readShiftsData();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(data));
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) {
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const saved = writeShiftsData(parsed.shifts || []);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(saved));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "不正なデータ形式です" }));
        }
      });
      return;
    }
  }

  // --- 静的ファイル配信 ---
  const safePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const fullPath = path.join(__dirname, safePath);

  // ディレクトリトラバーサル防止とデータファイル直接閲覧防止
  if (!fullPath.startsWith(__dirname) || path.basename(fullPath) === "shifts-data.json") {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/?key=${ACCESS_KEY}`);
});
