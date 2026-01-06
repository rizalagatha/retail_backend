const pool = require("../config/database");

const getBrowseData = async (startDate, endDate, filterCabang, user) => {
  let branchConditions = "";

  // Logika Filter Cabang
  if (user.cabang === "KDC") {
    if (filterCabang && filterCabang !== "ALL") {
      branchConditions = `AND k.bk_cab = ${pool.escape(filterCabang)}`;
    }
  } else {
    // User cabang Prioritas/Lainnya dipaksa hanya melihat cabangnya sendiri
    branchConditions = `AND k.bk_cab = ${pool.escape(user.cabang)}`;
  }

  const query = `
    SELECT 
      x.Nomor, x.Tanggal, x.Invoice, x.BiayaKirim, x.Bayar, 
      (x.BiayaKirim - x.Bayar) AS SisaPiutang,
      x.KdCus, x.Customer, x.Alamat, x.Kota, x.Keterangan, x.Created, x.Closing
    FROM (
      SELECT 
        k.bk_nomor AS Nomor, k.bk_tanggal AS Tanggal,
        k.bk_inv_nomor AS Invoice, k.bk_nominal AS BiayaKirim,
        IFNULL((SELECT SUM(p.pd_kredit) FROM tpiutang_dtl p WHERE p.pd_ph_nomor = k.bk_nomor), 0) AS Bayar,
        h.inv_cus_kode AS KdCus, c.cus_nama AS Customer, 
        c.cus_alamat AS Alamat, c.cus_kota AS Kota, 
        k.bk_ket AS Keterangan, k.user_create AS Created, k.bk_closing AS Closing
      FROM tbiayakirim k
      LEFT JOIN tinv_hdr h ON h.inv_nomor = k.bk_inv_nomor
      LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
      -- FIX: Gunakan DATE() agar pencarian akurat meskipun data disimpan dengan jam
      WHERE DATE(k.bk_tanggal) BETWEEN ? AND ?
      ${branchConditions}
    ) x 
    ORDER BY x.Nomor ASC
  `;
  const [rows] = await pool.query(query, [startDate, endDate]);
  return rows;
};

const getDetailPayments = async (nomorMaster) => {
  const query = `
    SELECT 
      pd_ph_nomor AS NomorBK, -- Harus NomorBK sesuai detailHeaders
      pd_tanggal AS Tanggal, 
      pd_uraian AS Uraian, 
      pd_kredit AS Bayar, 
      pd_ket AS Keterangan
    FROM tpiutang_dtl
    WHERE pd_bk = "Y" AND pd_ph_nomor = ?
    ORDER BY pd_tanggal ASC
  `;
  const [rows] = await pool.query(query, [nomorMaster]);
  return rows;
};

const deleteBiayaKirim = async (nomor, user) => {
  // Validasi Cabang & Closing sesuai Delphi
  const branchPrefix = nomor.substring(0, 3);
  if (user.cabang !== "KDC" && user.cabang !== branchPrefix) {
    throw new Error(`Data tersebut milik cabang ${branchPrefix}.`);
  }

  const [check] = await pool.query(
    "SELECT bk_closing FROM tbiayakirim WHERE bk_nomor = ?",
    [nomor]
  );
  if (check.length > 0 && check[0].bk_closing === "Y") {
    throw new Error("Data sudah Closing, tidak bisa dihapus.");
  }

  await pool.query("DELETE FROM tbiayakirim WHERE bk_nomor = ?", [nomor]);
  return true;
};

module.exports = { getBrowseData, getDetailPayments, deleteBiayaKirim };
