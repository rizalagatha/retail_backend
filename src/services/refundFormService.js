const pool = require("../config/database");
const { format, parseISO } = require("date-fns");
const fs = require("fs");
const path = require("path");

// --- FUNGSI TERBILANG ---
function terbilang(n) {
  if (n === null || n === undefined || isNaN(n)) return "Nol";
  n = Math.floor(Math.abs(n));
  const ang = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];
  const terbilangRecursive = (num) => {
    if (num < 12) return ang[num];
    if (num < 20) return terbilangRecursive(num - 10) + " belas";
    if (num < 100)
      return (
        (ang[Math.floor(num / 10)] || "") +
        " puluh " +
        terbilangRecursive(num % 10)
      );
    if (num < 200) return "seratus " + terbilangRecursive(num - 100);
    if (num < 1000)
      return (
        terbilangRecursive(Math.floor(num / 100)) +
        " ratus " +
        terbilangRecursive(num % 100)
      );
    if (num < 2000) return "seribu " + terbilangRecursive(num - 1000);
    if (num < 1000000)
      return (
        terbilangRecursive(Math.floor(num / 1000)) +
        " ribu " +
        terbilangRecursive(num % 1000)
      );
    if (num < 1000000000)
      return (
        terbilangRecursive(Math.floor(num / 1000000)) +
        " juta " +
        terbilangRecursive(n % 1000000)
      );
    if (num < 1000000000000)
      return (
        terbilangRecursive(Math.floor(num / 1000000000)) +
        " miliar " +
        terbilangRecursive(n % 1000000000)
      );
    return "angka terlalu besar";
  };
  let hasil = terbilangRecursive(n).replace(/\s+/g, " ").trim();
  return hasil.charAt(0).toUpperCase() + hasil.slice(1);
}
// ------------------------------------

// Helper: getmaxnomor
const generateNewNomor = async (connection, cabang, tanggal) => {
  const prefix = `${cabang}RF${format(new Date(tanggal), "yyMM")}`;
  const query = `SELECT IFNULL(MAX(RIGHT(rf_nomor, 5)), 0) as max_nomor FROM trefund_hdr WHERE LEFT(rf_nomor, 9) = ?`;
  const [rows] = await connection.query(query, [prefix]);
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(nextNum).padStart(5, "0")}`;
};

// Helper: getshidrec
const getSetorHeaderId = async (connection, nomorSetor) => {
  const [rows] = await connection.query(
    "SELECT sh_idrec FROM tsetor_hdr WHERE sh_nomor = ?",
    [nomorSetor]
  );
  return rows[0]?.sh_idrec;
};

// F1: Mencari Invoice (Piutang Negatif)
const getInvoiceLookup = async (cabang) => {
  const query = `
        SELECT X.*, (X.Nominal - X.Bayar) AS Sisa
        FROM (
            SELECT 
                h.inv_nomor AS Nomor, -- GANTI ALIAS DARI 'Invoice' ke 'Nomor'
                DATE_FORMAT(h.inv_tanggal, "%d-%m-%Y") AS Tanggal,
                h.inv_cus_kode AS Kdcus,
                c.cus_nama AS Customer,
                p.ph_nominal AS Nominal,
                IFNULL((SELECT SUM(q.pd_kredit) FROM tpiutang_dtl q WHERE q.pd_ph_nomor = p.ph_nomor), 0) AS Bayar
            FROM tinv_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
            LEFT JOIN tpiutang_hdr p ON p.ph_inv_nomor = h.inv_nomor
            WHERE LEFT(h.inv_nomor, 3) = ?
        ) X
        WHERE (X.Nominal - X.Bayar) < 0
        ORDER BY X.Nomor; -- GANTI ORDER BY DARI 'X.Invoice' ke 'X.Nomor'
    `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

// F2: Mencari Setoran (Lebih Bayar)
const getDepositLookup = async (cabang) => {
  const query = `
        SELECT X.*, (X.Nominal - X.Bayar) AS Sisa
        FROM (
            SELECT 
                h.sh_nomor AS Nomor,
                DATE_FORMAT(h.sh_tanggal, "%d-%m-%Y") AS Tanggal,
                h.sh_cus_kode AS Kdcus,
                c.cus_nama AS Customer,
                h.sh_nominal AS Nominal,
                IFNULL((SELECT SUM(q.sd_bayar) FROM tsetor_dtl q WHERE q.sd_sh_nomor = h.sh_nomor), 0) AS Bayar
            FROM tsetor_hdr h
            LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
            WHERE LEFT(h.sh_nomor, 3) = ?
        ) X
        WHERE (X.Nominal - X.Bayar) > 0
        ORDER BY X.Nomor;
    `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

// Tambahkan fungsi ini
const getSoDetailsForRefund = async (soNomor) => {
  // 1. Ambil Data Header SO
  const headerQuery = `
      SELECT 
        h.so_nomor, h.so_tanggal, h.so_cus_kode, c.cus_nama
      FROM tso_hdr h
      LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
      WHERE h.so_nomor = ?
    `;
  const [headerRows] = await pool.query(headerQuery, [soNomor]);

  if (headerRows.length === 0) {
    throw new Error("Nomor SO tidak ditemukan.");
  }

  const header = headerRows[0];

  // 2. Ambil Data DP (Uang Muka)
  const dpQuery = `
        SELECT 
            h.sh_nomor AS nomor, 
            h.sh_tanggal AS tanggal,
            IF(h.sh_jenis=0, "TUNAI", IF(h.sh_jenis=1, "TRANSFER", "GIRO")) AS jenis,
            (h.sh_nominal - IFNULL((SELECT SUM(d.sd_bayar) FROM tsetor_dtl d WHERE d.sd_sh_nomor = h.sh_nomor), 0)) AS nominal,
            h.sh_ket AS ket
        FROM tsetor_hdr h
        WHERE h.sh_otomatis = "N" 
          AND h.sh_so_nomor = ? 
        HAVING nominal > 0;
    `;
  const [dps] = await pool.query(dpQuery, [soNomor]);

  return {
    header: {
      nomor: header.so_nomor,
      tanggal: header.so_tanggal,
      kdcus: header.so_cus_kode,
      customer: header.cus_nama,
    },
    dps: dps,
  };
};

const getDataForEdit = async (nomor) => {
  const query = `
        SELECT 
            h.rf_nomor, h.rf_tanggal, h.user_create, h.rf_acc, h.rf_status,
            d.rfd_notrs, d.rfd_cus_kode, d.rfd_nominal, d.rfd_refund, d.rfd_ket, 
            d.rfd_iddrec, d.rfd_bank, d.rfd_norek, d.rfd_atasnama,
            c.cus_nama,
            IFNULL(DATE_FORMAT(i.inv_tanggal, "%d-%m-%Y"), DATE_FORMAT(s.sh_tanggal, "%d-%m-%Y")) AS tanggal
        FROM trefund_hdr h
        LEFT JOIN trefund_dtl d ON d.rfd_nomor = h.rf_nomor -- [UBAH DARI INNER JOIN KE LEFT JOIN]
        LEFT JOIN tcustomer c ON c.cus_kode = d.rfd_cus_kode
        LEFT JOIN tinv_hdr i ON i.inv_nomor = d.rfd_notrs
        LEFT JOIN tsetor_hdr s ON s.sh_nomor = d.rfd_notrs
        WHERE h.rf_nomor = ?
        ORDER BY d.rfd_nourut;
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Nomor refund tidak ditemukan.");

  const header = {
    nomor: rows[0].rf_nomor,
    tanggal: format(new Date(rows[0].rf_tanggal), "yyyy-MM-dd"),
    userCreate: rows[0].user_create,
    userApv: rows[0].rf_acc,
    isProcessed: !!rows[0].rf_status,
    isApproved: rows[0].rf_status === "APPROVE",
    keterangan: "",
  };

  // Filter detail yang valid (karena LEFT JOIN bisa hasilkan row dengan detail null)
  const details = rows
    .filter((d) => d.rfd_notrs) // Hanya ambil yang punya nomor transaksi
    .map((d) => ({
      id: Math.random(),
      nomor: d.rfd_notrs,
      tanggal: d.tanggal,
      kdcus: d.rfd_cus_kode,
      customer: d.cus_nama,
      nominal: d.rfd_nominal,
      refund: d.rfd_refund,
      apv: d.rfd_refund > 0,
      ket: d.rfd_ket,
      iddrec: d.rfd_iddrec,
      bank: d.rfd_bank,
      norek: d.rfd_norek,
      atasnama: d.rfd_atasnama,
    }));

  return { header, details };
};

// Menyimpan data (simpandata)
const saveData = async (data, user) => {
  const { header, details, isNew, isApprover } = data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let rfNomor = header.nomor;
    let cidrec = "";

    let cStatus = "";
    if (isApprover) {
      cStatus = header.isApproved ? "APPROVE" : "PROSES";
    }

    if (isNew) {
      const randomSuffix = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0");
      cidrec = `${user.cabang}RF${format(
        new Date(),
        "yyyyMMddHHmmssSSS"
      )}${randomSuffix}`;

      rfNomor = await generateNewNomor(connection, user.cabang, header.tanggal);

      await connection.query(
        "INSERT INTO trefund_hdr (rf_idrec, rf_nomor, rf_tanggal, user_create, date_create) VALUES (?, ?, ?, ?, NOW())",
        [cidrec, rfNomor, header.tanggal, user.kode]
      );
    } else {
      const [hdr] = await connection.query(
        "SELECT rf_idrec FROM trefund_hdr WHERE rf_nomor = ?",
        [rfNomor]
      );
      cidrec = hdr[0].rf_idrec;

      let query = "UPDATE trefund_hdr SET rf_tanggal = ?";
      const params = [header.tanggal];

      if (isApprover) {
        query += ", date_acc = NOW(), rf_acc = ?, rf_status = ?";
        params.push(user.kode, cStatus);
      } else {
        query += ", user_modified = ?, date_modified = NOW()";
        params.push(user.kode);
      }
      query += " WHERE rf_nomor = ?";
      params.push(rfNomor);

      await connection.query(query, params);
    }

    // --- Proses Detail ---
    if (!isApprover) {
      // Jika PENGGUNA BIASA, hapus dan insert ulang detail
      await connection.query("DELETE FROM trefund_dtl WHERE rfd_nomor = ?", [
        rfNomor,
      ]);
     for (const [index, item] of details.entries()) {
       if (item.nomor) {
         // PERBAIKAN 2: Tambahkan kolom rfd_refund agar input user tersimpan
         await connection.query(
           "INSERT INTO trefund_dtl (rfd_idrec, rfd_iddrec, rfd_nomor, rfd_notrs, rfd_cus_kode, rfd_nominal, rfd_refund, rfd_ket, rfd_nourut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
           [
             cidrec,
             item.iddrec,
             rfNomor,
             item.nomor,
             item.kdcus,
             item.nominal,
             item.refund || 0, // [FIX] Simpan nilai refund inputan user
             item.ket,
             index + 1,
           ]
         );
       }
     }
    } else {
      // Jika APPROVER, update detail dan proses piutang/setoran
      for (const item of details) {
        if (item.iddrec) {
          await connection.query(
            "UPDATE trefund_dtl SET rfd_bank = ?, rfd_norek = ?, rfd_atasnama = ?, rfd_refund = ? WHERE rfd_idrec = ? AND rfd_iddrec = ?",
            [
              item.bank,
              item.norek,
              item.atasnama,
              cStatus === "APPROVE" ? item.refund : 0,
              cidrec,
              item.iddrec,
            ]
          );

          if (cStatus === "APPROVE" && item.refund > 0) {
            if (item.nomor.includes(".INV.")) {
              // Proses Piutang
              await connection.query(
                `INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur) 
                                 VALUES (?, ?, "REFUND", ?, ?, ?) 
                                 ON DUPLICATE KEY UPDATE pd_kredit = ?`,
                [
                  `${item.kdcus}${item.nomor}`,
                  header.tanggal,
                  item.refund * -1,
                  rfNomor,
                  item.iddrec,
                  item.refund * -1,
                ]
              );
            } else if (item.nomor.includes(".STR.")) {
              // Proses Setoran
              const shidrec = await getSetorHeaderId(connection, item.nomor);
              await connection.query(
                `INSERT INTO tsetor_dtl (sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur) 
                                 VALUES (?, ?, NOW(), "", ?, ?, ?) 
                                 ON DUPLICATE KEY UPDATE sd_bayar = ?`,
                [
                  shidrec,
                  item.nomor,
                  item.refund,
                  rfNomor,
                  item.iddrec,
                  item.refund,
                ]
              );
            }
          }
        }
      }
    }

    await connection.commit();
    return { message: `Refund ${rfNomor} berhasil disimpan.`, nomor: rfNomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Mengambil data untuk cetak Refund.
 * Menerjemahkan TfrmRefund.cetak
 */
const getPrintData = async (nomor, user) => {
  // Cek file tanda tangan
  const signaturePath = path.join(
    __dirname,
    "../../public/images/signatures",
    `${user.kode}.jpg`
  ); // Sesuaikan path jika perlu
  const userSignature = fs.existsSync(signaturePath) ? user.kode : "NO";

  const query = `
        SELECT 
            h.*, d.*, c.cus_nama,
            IFNULL(DATE_FORMAT(i.inv_tanggal,"%d-%m-%Y"), DATE_FORMAT(s.sh_tanggal,"%d-%m-%Y")) AS tanggal_transaksi,
            g.gdg_inv_nama, g.gdg_inv_alamat, g.gdg_inv_kota, g.gdg_inv_telp,
            ? AS usr_signature
        FROM trefund_hdr h
        LEFT JOIN trefund_dtl d ON d.rfd_nomor = h.rf_nomor
        LEFT JOIN retail.tcustomer c ON c.cus_kode = d.rfd_cus_kode
        LEFT JOIN tinv_hdr i ON i.inv_nomor = d.rfd_notrs
        LEFT JOIN tsetor_hdr s ON s.sh_nomor = d.rfd_notrs
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.rf_nomor, 3)
        WHERE h.rf_nomor = ?
        ORDER BY d.rfd_nourut;
    `;

  const [rows] = await pool.query(query, [userSignature, nomor]);
  if (rows.length === 0) throw new Error("Data cetak tidak ditemukan.");

  const header = { ...rows[0] };
  delete header.rfd_notrs; // Hapus properti detail dari header
  // ... (hapus properti detail lainnya)

  const details = rows
    .filter((row) => row.rfd_notrs) // Filter baris yang punya data detail
    .map((row) => ({
      rfd_notrs: row.rfd_notrs,
      tanggal_transaksi: row.tanggal_transaksi,
      rfd_cus_kode: row.rfd_cus_kode,
      cus_nama: row.cus_nama,
      rfd_nominal: row.rfd_nominal,
      rfd_refund: row.rfd_refund,
      rfd_ket: row.rfd_ket,
      rfd_bank: row.rfd_bank,
      rfd_norek: row.rfd_norek,
      rfd_atasnama: row.rfd_atasnama,
    }));

  // Hitung total
  const totalRefund = details.reduce(
    (sum, item) => sum + (item.rfd_refund || item.rfd_nominal || 0),
    0
  );
  header.totalRefund = totalRefund;
  header.terbilang = terbilang(totalRefund);

  return { header, details };
};

module.exports = {
  getInvoiceLookup,
  getDepositLookup,
  getSoDetailsForRefund,
  getDataForEdit,
  saveData,
  getPrintData,
};
