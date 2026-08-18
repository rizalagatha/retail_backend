const mysql = require("mysql2/promise");
require("dotenv/config");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10, // batas koneksi idle di pool
  idleTimeout: 60000, // bersihkan koneksi idle setelah 60s agar tidak diputus paksa MySQL / firewall
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0, // kirim keepalive TCP secepat mungkin
});

// [BARU] Tangkap error di level pool (mis. koneksi idle diputus paksa oleh
// firewall/NAT sebelum sempat dipakai ulang) — tanpa listener ini, error
// semacam ini jadi unhandled di level proses dan bikin seluruh server crash.
pool.on("error", (err) => {
  console.error("[MYSQL POOL ERROR]", err.code, err.message);
});

console.log("🔌 Koneksi ke database MySQL berhasil dibuat.");

module.exports = pool;
