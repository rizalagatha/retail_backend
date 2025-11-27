const pool = require("../config/database");

const getList = async (filters, user) => {
  const { startDate, endDate, belumAccSaja } = filters;

  let whereClauses = ["h.kor_tanggal BETWEEN ? AND ?"];
  let params = [startDate, endDate];

  // Terjemahan logika otorisasi dari Delphi
  if (user.cabang !== "KDC") {
    whereClauses.push("h.kor_cab = ?");
    params.push(user.cabang);
  } else if (user.cabang === "KDC" && !user.canApproveCorrection) {
    // Asumsi ada hak akses 'canApproveCorrection'
    whereClauses.push(
      "h.kor_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc=1)"
    );
  }

  if (belumAccSaja === "true" || belumAccSaja === true) {
    whereClauses.push('h.kor_acc = ""');
  }

  const masterQuery = `
        SELECT 
            h.kor_nomor AS nomor,
            h.kor_tanggal AS tanggal,
            h.kor_ket AS keterangan,
            h.kor_acc AS diAccOleh,
            DATE_FORMAT(h.date_acc, "%d-%m-%Y %H:%i:%s") AS tglAcc,
            h.kor_closing AS closing
        FROM tkor_hdr h
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY h.kor_tanggal DESC, h.kor_nomor DESC;
    `;
  const [rows] = await pool.query(masterQuery, params);
  return rows;
};

const getDetails = async (nomor) => {
  const detailQuery = `
        SELECT 
            d.kord_kode AS kode,
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS nama,
            d.kord_ukuran AS ukuran,
            d.kord_stok AS stok,
            d.kord_jumlah AS jumlah,
            (d.kord_jumlah - d.kord_stok) AS selisih,
            (d.kord_selisih * d.kord_hpp) AS nominal,
            d.kord_ket AS keterangan
        FROM tkor_dtl d
        LEFT JOIN tbarangdc a ON a.brg_kode = d.kord_kode
        WHERE d.kord_kor_nomor = ?;
    `;
  const [rows] = await pool.query(detailQuery, [nomor]);
  return rows;
};

// Fungsi untuk ACC dan Batal ACC (meniru cxButton5Click)
const toggleApproval = async (nomor, user) => {
  if (!user.canApproveCorrection) {
    throw new Error(
      "Anda tidak memiliki hak untuk melakukan ACC pada modul ini."
    );
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [headerRows] = await connection.query(
      "SELECT kor_acc FROM tkor_hdr WHERE kor_nomor = ?",
      [nomor]
    );
    if (headerRows.length === 0) throw new Error("Dokumen tidak ditemukan.");

    const isApproved = headerRows[0].kor_acc !== "";

    if (isApproved) {
      // Logika Batal ACC
      await connection.query("DELETE FROM tkor_dtl2 WHERE kord2_nomor = ?", [
        nomor,
      ]);
      await connection.query(
        'UPDATE tkor_hdr SET kor_acc = "", date_acc = NULL WHERE kor_nomor = ?',
        [nomor]
      );
    } else {
      // Logika ACC
      const [detailRows] = await connection.query(
        "SELECT * FROM tkor_dtl WHERE kord_kor_nomor = ?",
        [nomor]
      );
      if (detailRows.length > 0) {
        const insertValues = detailRows.map((d) => [
          d.kord_kor_nomor,
          d.kord_kode,
          d.kord_ukuran,
          d.kord_jumlah - d.kord_stok,
        ]);
        await connection.query(
          "INSERT INTO tkor_dtl2 (kord2_nomor, kord2_kode, kord2_ukuran, kord2_selisih) VALUES ?",
          [insertValues]
        );
      }
      await connection.query(
        "UPDATE tkor_hdr SET kor_acc = ?, date_acc = NOW() WHERE kor_nomor = ?",
        [user.kode, nomor]
      );
    }

    await connection.commit();
    return {
      message: `Dokumen ${nomor} berhasil di-${
        isApproved ? "batalkan ACC" : "ACC"
      }.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const remove = async (nomor, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [headerRows] = await connection.query(
      "SELECT kor_acc, kor_closing, kor_cab AS cabang FROM tkor_hdr WHERE kor_nomor = ?",
      [nomor]
    );
    if (headerRows.length === 0) throw new Error("Dokumen tidak ditemukan.");
    const header = headerRows[0];

    // Validasi dari Delphi
    if (header.kor_acc) throw new Error("Sudah di-ACC, tidak bisa dihapus.");
    if (header.kor_closing === "Y")
      throw new Error("Sudah Closing, tidak bisa dihapus.");
    if (header.cabang !== user.cabang && user.cabang !== "KDC")
      throw new Error("Anda tidak berhak menghapus data cabang lain.");

    // Hapus detail dan header
    await connection.query("DELETE FROM tkor_dtl WHERE kord_kor_nomor = ?", [
      nomor,
    ]);
    await connection.query("DELETE FROM tkor_hdr WHERE kor_nomor = ?", [nomor]);

    await connection.commit();
    return { message: `Dokumen ${nomor} berhasil dihapus.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getExportDetails = async (filters, user) => {
  const { startDate, endDate, belumAccSaja } = filters;

  let whereClauses = ["h.kor_tanggal BETWEEN ? AND ?"];
  let params = [startDate, endDate];

  // Terapkan filter otorisasi yang sama dengan getList
  if (user.cabang !== "KDC") {
    whereClauses.push("h.kor_cab = ?");
    params.push(user.cabang);
  } else if (user.cabang === "KDC" && !user.canApproveCorrection) {
    whereClauses.push(
      "h.kor_cab IN (SELECT gdg_kode FROM tgudang WHERE gdg_dc=1)"
    );
  }

  if (belumAccSaja === "true" || belumAccSaja === true) {
    whereClauses.push('h.kor_acc = ""');
  }

  const query = `
        SELECT 
            h.kor_nomor AS 'Nomor Koreksi',
            h.kor_tanggal AS 'Tanggal',
            h.kor_ket AS 'Keterangan Header',
            h.kor_acc AS 'DiAcc Oleh',
            d.kord_kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)) AS 'Nama Barang',
            d.kord_ukuran AS 'Ukuran',
            d.kord_stok AS 'Stok Awal',
            d.kord_jumlah AS 'Stok Fisik',
            (d.kord_jumlah - d.kord_stok) AS 'Selisih',
            d.kord_hpp AS 'HPP',
            ((d.kord_jumlah - d.kord_stok) * d.kord_hpp) AS 'Nominal',
            d.kord_ket AS 'Keterangan Item'
        FROM tkor_hdr h
        INNER JOIN tkor_dtl d ON d.kord_kor_nomor = h.kor_nomor
        LEFT JOIN tbarangdc a ON a.brg_kode = d.kord_kode
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY h.kor_tanggal, h.kor_nomor;
    `;
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getDetails,
  toggleApproval,
  remove,
  getExportDetails,
};
