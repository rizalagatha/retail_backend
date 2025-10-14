const pool = require("../config/database");

const getList = async () => {
  const query = `
        SELECT 
            pro_nomor AS nomor,
            pro_judul AS judul,
            pro_tanggal1 AS tanggal1,
            pro_tanggal2 AS tanggal2,
            CASE 
                WHEN pro_jenis = 1 THEN 'TOTAL RP'
                WHEN pro_jenis = 2 THEN 'TOTAL QTY'
                ELSE 'LAIN-LAIN'
            END AS jenis,
            pro_totalrp AS totalRp,
            pro_totalqty AS totalQty,
            pro_disrp AS diskonRp,
            pro_dispersen AS diskonPersen,
            pro_lipat AS kelipatan,
            pro_generate AS generate,
            pro_rpvoucher AS rpVoucher,
            pro_keterangan AS keterangan
        FROM tpromo
        ORDER BY pro_tanggal2 DESC;
    `;
  const [rows] = await pool.query(query);
  return rows;
};

const remove = async (nomor) => {
  const [deleteResult] = await pool.query(
    "DELETE FROM tpromo WHERE pro_nomor = ?",
    [nomor]
  );
  if (deleteResult.affectedRows === 0) {
    throw new Error("Data promo tidak ditemukan.");
  }
  return { message: `Promo ${nomor} berhasil dihapus.` };
};

module.exports = { getList, remove };
