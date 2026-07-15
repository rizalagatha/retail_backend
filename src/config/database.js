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
  queueLimit: 0,
  // [BARU] TCP keepalive — kirim paket "masih hidup" berkala ke koneksi
  // idle, supaya firewall/NAT di jalur jaringan (antara app server dan
  // 103.94.238.252) tidak diam-diam motong koneksi yang didiamkan pool,
  // sebelum wait_timeout MySQL (28800s) sempat kepakai. Ini kandidat kuat
  // penyebab "Aborted connection" yang berulang di log MariaDB.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // mulai kirim keepalive setelah 10 detik idle
});

console.log("🔌 Koneksi ke database MySQL berhasil dibuat.");

module.exports = pool;
