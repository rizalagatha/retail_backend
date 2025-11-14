const jwt = require("jsonwebtoken");
const pool = require("../config/database"); // Sesuaikan path ke koneksi database Anda

// Middleware untuk memverifikasi token JWT
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res
      .status(401)
      .json({ message: "Akses ditolak. Token tidak disediakan." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Token tidak valid." });
    }
    req.user = user; // Menyimpan data user dari token ke object request
    next();
  });
};

// Middleware untuk memeriksa hak akses spesifik (view, insert, edit, delete)
const checkPermission = (menuId, action) => {
  return async (req, res, next) => {
    const userKode = req.user.kode; // Diambil dari middleware verifyToken

    // Mapping action ke nama kolom di database
    const actionColumnMap = {
      view: "hak_men_view",
      insert: "hak_men_insert",
      edit: "hak_men_edit",
      delete: "hak_men_delete",
    };

    const column = actionColumnMap[action];
    if (!column) {
      return res.status(500).json({ message: "Aksi tidak valid." });
    }

    try {
      const query = `
                SELECT ${column} 
                FROM thakuser 
                WHERE hak_user_kode = ? AND hak_men_id = ?`;

      const [rows] = await pool.query(query, [userKode, menuId]);

      if (rows.length > 0 && rows[0][column] === "Y") {
        next(); // Pengguna memiliki izin, lanjutkan ke controller
      } else {
        res
          .status(403)
          .json({
            message: "Anda tidak memiliki izin untuk melakukan aksi ini.",
          });
      }
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Terjadi kesalahan pada server.",
          error: error.message,
        });
    }
  };
};

const checkInsertOrEditPermission = (menuId) => {
  return async (req, res, next) => {
    const userKode = req.user.kode;

    try {
      const query = `
                SELECT hak_men_insert, hak_men_edit 
                FROM thakuser 
                WHERE hak_user_kode = ? AND hak_men_id = ?
            `;
      const [rows] = await pool.query(query, [userKode, menuId]);

      // Lanjutkan jika pengguna punya salah satu dari dua hak akses
      if (
        rows.length > 0 &&
        (rows[0].hak_men_insert === "Y" || rows[0].hak_men_edit === "Y")
      ) {
        next();
      } else {
        res
          .status(403)
          .json({
            message:
              "Anda tidak memiliki izin untuk mengakses sumber daya ini.",
          });
      }
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Terjadi kesalahan pada server.",
          error: error.message,
        });
    }
  };
};

const checkSavePermission = (menuId) => {
  return async (req, res, next) => {
    // Tentukan action berdasarkan body
    const action = req.body.isNew ? "insert" : "edit";

    // Reuse checkPermission yang udah ada
    return checkPermission(menuId, action)(req, res, next);
  };
};

module.exports = {
  verifyToken,
  checkPermission,
  checkInsertOrEditPermission,
  checkSavePermission,
};
