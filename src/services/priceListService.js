const pool = require("../config/database");

const getList = async (filters) => {
  const { kategori, hargaKosong } = filters;

  let whereClause = 'WHERE a.brg_aktif = 0 AND a.brg_logstok = "Y"';
  if (kategori === "Kaosan") {
    whereClause += ' AND a.brg_ktg = ""';
  } else if (kategori === "Rezso") {
    whereClause += ' AND a.brg_ktg <> ""';
  }

  if (hargaKosong === "true" || hargaKosong === true) {
    whereClause +=
      " AND a.brg_kode IN (SELECT DISTINCT d.brgd_kode FROM tbarangdc_dtl d WHERE d.brgd_harga = 0)";
  }

  const query = `
        SELECT 
            a.brg_kode AS kode,
            a.brg_ktgp AS kategori,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama
        FROM tbarangdc a
        ${whereClause}
        ORDER BY nama;
    `;
  const [rows] = await pool.query(query);
  return rows;
};

const getDetails = async (kode) => {
  const query = `
        SELECT 
            b.brgd_kode AS kode,
            b.brgd_barcode AS barcode,
            b.brgd_ukuran AS ukuran,
            b.brgd_hpp AS hpp,
            b.brgd_harga AS harga,
            (b.brgd_harga - b.brgd_hpp) AS laba
        FROM tbarangdc_dtl b
        WHERE b.brgd_kode = ?
        ORDER BY b.brgd_barcode;
    `;
  const [rows] = await pool.query(query, [kode]);
  return rows;
};

const updatePrices = async (payload) => {
  const { kode, variants } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const variant of variants) {
      await connection.query(
        "UPDATE tbarangdc_dtl SET brgd_hpp = ?, brgd_harga = ? WHERE brgd_kode = ? AND brgd_ukuran = ?",
        [variant.hpp, variant.harga, kode, variant.ukuran]
      );
    }

    await connection.commit();
    return { message: `Harga untuk produk ${kode} berhasil diperbarui.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { getList, getDetails, updatePrices };
