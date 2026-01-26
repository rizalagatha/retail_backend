const pool = require("../config/database");

const getLogs = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      module: mod,
      user,
      action,
      cabang,
      page = 1,
      itemsPerPage = 20,
      isAnomaly,
    } = req.query;

    const offset = (Number(page) - 1) * Number(itemsPerPage);
    const limit = Number(itemsPerPage);

    let conditions = ["1=1"];
    let params = [];

    // [OPTIMASI 1] Filter khusus anomali
    if (isAnomaly === "true") {
      conditions.push("action LIKE 'ANOMALY_%'");
    } else if (action && action !== "ALL") {
      conditions.push("action = ?");
      params.push(action);
    }

    if (startDate && endDate) {
      conditions.push("DATE(log_date) BETWEEN ? AND ?");
      params.push(startDate, endDate);
    }

    if (moduleName && moduleName !== "ALL") {
      conditions.push("module = ?");
      params.push(moduleName);
    }

    if (action && action !== "ALL") {
      conditions.push("action = ?");
      params.push(action);
    }

    if (user) {
      conditions.push("user_id LIKE ?");
      params.push(`%${user}%`);
    }

    if (cabang && cabang !== "ALL") {
      conditions.push("TRIM(user_cabang) = TRIM(?)");
      params.push(cabang);
    }

    const whereClause = "WHERE " + conditions.join(" AND ");

    // [FIX] Select log_date, Order by log_date
    const dataQuery = `
      SELECT id, log_date, user_id, user_nama, user_cabang, action, module, target_id, note 
      FROM taudit_log
      ${whereClause}
      ORDER BY log_date DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataQuery, [...params, limit, offset]);
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM taudit_log ${whereClause}`,
      params,
    );

    res.json({ items: rows, total: countResult[0].total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getLogById = async (req, res) => {
  try {
    const { id } = req.params;
    // Di sini kita SELECT * termasuk old_values dan new_values
    const [rows] = await pool.query("SELECT * FROM taudit_log WHERE id = ?", [
      id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Log tidak ditemukan." });
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getModules = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT DISTINCT module FROM taudit_log ORDER BY module",
    );
    res.json(rows.map((r) => r.module));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getActions = async (req, res) => {
  try {
    // Mengambil distinct action agar dropdown sesuai isi database
    const [rows] = await pool.query(
      "SELECT DISTINCT action FROM taudit_log ORDER BY action",
    );
    res.json(rows.map((r) => r.action));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getCabangList = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT user_cabang 
      FROM taudit_log 
      WHERE user_cabang IS NOT NULL 
      AND user_cabang <> ''
      ORDER BY user_cabang
    `);

    res.json(rows.map((r) => r.user_cabang));
  } catch (error) {
    console.error("Error get cabang:", error);
    res.status(500).json({ message: "Gagal mengambil daftar cabang" });
  }
};

module.exports = { getLogs, getLogById, getModules, getActions, getCabangList };
