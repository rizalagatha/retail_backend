const pool = require("../config/database");
const fs = require("fs");
const path = require("path");

const getAllMemos = async () => {
  const [rows] = await pool.query(
    "SELECT mi_id AS id, mi_judul AS title, mi_filename AS filename, DATE_FORMAT(mi_date_upload, '%d/%m/%Y') AS date FROM tmemo_internal ORDER BY mi_date_upload DESC",
  );
  // Tambahkan URL lengkap untuk iframe frontend
  return rows.map((r) => ({
    ...r,
    url: `${process.env.BASE_URL || "http://localhost:8000"}/memos/${r.filename}`,
  }));
};

const uploadMemo = async (title, tempPath, filename, user) => {
  const targetDir = path.join(process.cwd(), "public", "memos");
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const finalPath = path.join(targetDir, filename);

  // Pindahkan file dari temp ke public/memos
  fs.renameSync(tempPath, finalPath);

  const [result] = await pool.query(
    "INSERT INTO tmemo_internal (mi_judul, mi_filename, mi_user_upload) VALUES (?, ?, ?)",
    [title, filename, user.kode],
  );

  return { id: result.insertId, title };
};

module.exports = { getAllMemos, uploadMemo };
