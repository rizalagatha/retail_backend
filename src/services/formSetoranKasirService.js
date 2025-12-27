const pool = require("../config/database");

const getCabangList = async (user) => {
  let query = "";
  const params = [];
  if (user.cabang === "KDC") {
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode NOT IN ("KBS","KPS") ORDER BY gdg_kode';
  } else {
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ? ORDER BY gdg_kode";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

const getList = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const query = `
        SELECT 
            h.fsk_nomor AS Nomor,
            h.fsk_tanggal AS TglSetor,
            h.fsk_tanggalv AS TglVerifikasi,
            h.user_create AS Created,
            h.fsk_userv AS Verified,
            h.fsk_closing AS Closing
        FROM tform_setorkasir_hdr h
        WHERE LEFT(h.fsk_nomor, 3) = ? 
          AND h.fsk_tanggal BETWEEN ? AND ?
        ORDER BY h.fsk_tanggal;
    `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

const getDetails = async (nomor) => {
  const query = `
        SELECT 
            d.fskd2_jenis AS Jenis,
            d.fskd2_nominal AS NominalSetor,
            d.fskd2_nominalv AS NominalVerifikasi
        FROM tform_setorkasir_dtl2 d
        WHERE d.fskd2_nomor = ?
        ORDER BY d.fskd2_nomor;
    `;
  const [rows] = await pool.query(query, [nomor]);
  return rows;
};

const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `
            SELECT fsk_userv, fsk_closing FROM tform_setorkasir_hdr WHERE fsk_nomor = ?
        `,
      [nomor]
    );

    if (rows.length === 0) throw new Error("Data tidak ditemukan.");
    const setoran = rows[0];

    // --- VALIDASI PENTING ---
    if (setoran.fsk_userv) {
      throw new Error("Sudah di Verifikasi oleh Finance. Tidak bisa dihapus.");
    }
    if (nomor.substring(0, 3) !== user.cabang) {
      throw new Error(
        `Anda tidak berhak menghapus data milik cabang ${nomor.substring(
          0,
          3
        )}.`
      );
    }
    if (setoran.fsk_closing === "Y") {
      throw new Error("Sudah Closing. Tidak bisa dihapus.");
    }
    // --- AKHIR VALIDASI ---

    await connection.query(
      "DELETE FROM tform_setorkasir_hdr WHERE fsk_nomor = ?",
      [nomor]
    );

    await connection.commit();
    return { message: `Form Setoran Kasir ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// [BARU] Ambil semua Header dari Server
const getExportHeaders = async (filters) => {
  const { startDate, endDate, cabang } = filters;

  const query = `
    SELECT
      h.fsk_nomor AS 'Nomor',
      h.fsk_tanggal AS 'TglSetor',
      h.fsk_tanggalv AS 'TglVerifikasi',
      h.user_create AS 'DibuatOleh',
      h.fsk_userv AS 'DiverifikasiOleh',
      h.fsk_closing AS 'Closing'
    FROM tform_setorkasir_hdr h
    WHERE 
      LEFT(h.fsk_nomor, 3) = ? 
      AND DATE(h.fsk_tanggal) BETWEEN ? AND ?
    ORDER BY h.fsk_tanggal DESC, h.fsk_nomor DESC;
  `;

  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

// [UPDATE] Fix Date Filter pada Detail
const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const query = `
        SELECT
            h.fsk_nomor AS 'Nomor FSK',
            h.fsk_tanggal AS 'Tanggal Setor',
            h.fsk_tanggalv AS 'Tanggal Verifikasi',
            h.user_create AS 'Dibuat Oleh',
            h.fsk_userv AS 'Diverifikasi Oleh',
            d.fskd2_jenis AS 'Jenis Setoran',
            d.fskd2_nominal AS 'Nominal Setor',
            d.fskd2_nominalv AS 'Nominal Verifikasi'
        FROM tform_setorkasir_hdr h
        JOIN tform_setorkasir_dtl2 d ON h.fsk_nomor = d.fskd2_nomor
        WHERE 
            LEFT(h.fsk_nomor, 3) = ? 
            -- [FIX] Gunakan DATE() agar jam diabaikan
            AND DATE(h.fsk_tanggal) BETWEEN ? AND ?
        ORDER BY h.fsk_nomor, d.fskd2_jenis;
    `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

module.exports = {
  getCabangList,
  getList,
  getDetails,
  remove,
  getExportHeaders,
  getExportDetails,
};
