const pool = require("../config/database");
const { isDate, format, parseISO } = require("date-fns");

// Helper: getmaxnomor2
const generateNewInvNomor = async (connection, tanggal, cabang) => {
  const ayymm = format(new Date(tanggal), "yyMM");
  const prefix = `${cabang}.INV.${ayymm}.`;
  const [rows] = await connection.query(
    "SELECT IFNULL(MAX(RIGHT(inv_nomor, 4)), 0) as max_nomor FROM tinv_hdr WHERE LEFT(inv_nomor, 12) = ?",
    [prefix],
  );
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// Helper: getsetor2
const generateNewSetorNomor = async (connection, tanggal, cabang) => {
  const ayymm = format(new Date(tanggal), "yyMM");
  const prefix = `${cabang}.STR.${ayymm}.`;
  const [rows] = await connection.query(
    "SELECT IFNULL(MAX(RIGHT(sh_nomor, 4)), 0) as max_nomor FROM tsetor_hdr WHERE LEFT(sh_nomor, 12) = ?",
    [prefix],
  );
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

/**
 * Mengambil daftar invoice bazar dari tabel temporer.
 * Menerjemahkan TfrmKlerek.btmTempClick
 */
const getList = async (filters, user) => {
  const { startDate, endDate, cabang } = filters;

  // Validasi cabang
  const finalCabang = user.cabang === "KDC" ? cabang : user.cabang;
  if (!finalCabang) throw new Error("Cabang harus dipilih.");

  const query = `
        SELECT 
            h.inv_id AS nomor,
            h.inv_tanggal AS tanggal,
            n.nominal,
            h.inv_cus_kode AS kdcus,
            c.cus_nama AS nmcus,
            h.inv_klerek AS klerek,
            h.inv_nosetor AS setor,
            h.inv_nomor AS ket
        FROM tinv_hdr_tmp h
        LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
        LEFT JOIN (
            SELECT 
                hh.inv_id,
                (ROUND(SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc + (hh.inv_ppn/100 * (SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) - hh.inv_disc)))) AS nominal
            FROM tinv_dtl_tmp dd 
            LEFT JOIN tinv_hdr_tmp hh ON hh.inv_nomor = dd.invd_inv_nomor 
            GROUP BY hh.inv_nomor
        ) n ON n.inv_id = h.inv_id
        WHERE LEFT(h.inv_nomor, 3) = ?
          AND h.inv_tanggal BETWEEN ? AND ?
        ORDER BY h.inv_tanggal, h.inv_nomor;
    `;
  const params = [finalCabang, startDate, endDate];
  const [rows] = await pool.query(query, params);
  return rows;
};

/**
 * Memproses klerek (memindahkan dari _tmp ke tabel permanen).
 * Menerjemahkan TfrmKlerek.btnKlerektempClick
 */
const prosesKlerek = async (items, cabang, user) => {
  const connection = await pool.getConnection();
  let processedCount = 0;

  try {
    await connection.beginTransaction();

    if (!items || items.length === 0) return { message: "Tidak ada data." };

    const tglGrup = items[0].tanggal;
    const ayymm = format(
      isDate(tglGrup) ? tglGrup : parseISO(String(tglGrup)),
      "yyMM",
    );

    // 1. Ambil MAX nomor invoice
    const invPrefix = `${cabang}.INV.${ayymm}.`;
    const [maxInvRows] = await connection.query(
      "SELECT IFNULL(MAX(RIGHT(inv_nomor, 4)), 0) as max_nomor FROM tinv_hdr WHERE LEFT(inv_nomor, 12) = ? FOR UPDATE",
      [invPrefix],
    );
    let nextInvNum = parseInt(maxInvRows[0].max_nomor, 10) + 1;

    // 2. Ambil MAX nomor setoran (jika ada pembayaran non-tunai)
    const setorPrefix = `${cabang}.STR.${ayymm}.`;
    const [maxSetorRows] = await connection.query(
      "SELECT IFNULL(MAX(RIGHT(sh_nomor, 4)), 0) as max_nomor FROM tsetor_hdr WHERE LEFT(sh_nomor, 12) = ? FOR UPDATE",
      [setorPrefix],
    );
    let nextSetorNum = parseInt(maxSetorRows[0].max_nomor, 10) + 1;

    for (const item of items) {
      // Hanya proses jika belum diklerek
      if (!item.klerek || item.klerek === "0" || item.klerek === "") {
        const cnomor = item.nomor; // ini adalah inv_id
        const ckdcus = item.kdcus;

        // 1. Get No. Inv Reguler
        const cklerek = `${invPrefix}${String(nextInvNum).padStart(4, "0")}`;
        nextInvNum++;

        // 2. Header Inv Bazar
        const [tsql] = await connection.query(
          `SELECT h.*, r.rek_kode, 
                IFNULL(h.Inv_top, 0) AS Inv_top_safe,
                IFNULL(h.Inv_cus_kode, '') AS Inv_cus_kode_safe,
                IFNULL(h.Inv_nomor, '') AS Inv_nomor_safe 
            FROM tinv_hdr_tmp h 
            LEFT JOIN finance.trekening r ON r.rek_rekening = h.inv_nocard 
            WHERE inv_id = ?`,
          [cnomor],
        );
        if (tsql.length === 0) continue;
        const invHeader = tsql[0];
        const invTanggal = invHeader.inv_tanggal;
        const tglInv = isDate(invTanggal)
          ? invTanggal
          : parseISO(String(invTanggal));

        // 3. Insert ke inv_hdr permanen
        const cidrec = `${cabang}INV${format(new Date(), "yyyyMMddHHmmssSSS")}`;
        await connection.query(
          `INSERT INTO tinv_hdr (inv_idrec, inv_nomor, inv_nomor_so, inv_klerek, inv_tanggal, inv_cus_level, Inv_top, inv_ppn, inv_disc, inv_disc1, inv_disc2, inv_bkrm, inv_dp, inv_nodp, Inv_cus_kode, inv_pro_nomor, Inv_ket, inv_rptunai, inv_novoucher, inv_rpvoucher, inv_nocard, inv_rpcard, inv_nosetor, inv_mem_hp, inv_mem_nama, inv_mem_alamat, inv_mem_gender, inv_mem_usia, inv_mem_referensi, inv_print, inv_puas, inv_closing, user_create, date_create, user_modified, date_modified) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            cidrec,
            cklerek,
            invHeader.inv_nomor_so,
            cnomor,
            invHeader.inv_tanggal,
            invHeader.inv_cus_level,
            invHeader.Inv_top_safe,
            invHeader.inv_ppn,
            invHeader.inv_disc,
            invHeader.inv_disc1,
            invHeader.inv_disc2,
            invHeader.inv_bkrm,
            invHeader.inv_dp,
            invHeader.inv_nodp,
            invHeader.Inv_cus_kode_safe,
            invHeader.inv_pro_nomor,
            invHeader.Inv_nomor_safe,
            invHeader.inv_rptunai,
            invHeader.inv_novoucher,
            invHeader.inv_rpvoucher,
            invHeader.inv_nocard,
            invHeader.inv_rpcard,
            invHeader.inv_nosetor,
            invHeader.inv_mem_hp,
            invHeader.inv_mem_nama,
            invHeader.inv_mem_alamat,
            invHeader.inv_mem_gender,
            invHeader.inv_mem_usia,
            invHeader.inv_mem_referensi,
            invHeader.inv_print,
            invHeader.inv_puas,
            invHeader.inv_closing,
            invHeader.user_create,
            invHeader.date_create,
            user.kode, // Gunakan user dari session
          ],
        );

        // 4. Piutang Header
        await connection.query(
          "INSERT INTO tpiutang_hdr (ph_nomor, ph_tanggal, ph_cus_kode, ph_inv_nomor, ph_top, ph_nominal, ph_flag) VALUES (?, ?, ?, ?, 0, ?, 0) ON DUPLICATE KEY UPDATE ph_nominal = ?",
          [
            `${ckdcus}${cklerek}`,
            invHeader.inv_tanggal,
            invHeader.Inv_cus_kode_safe,
            cklerek,
            item.nominal,
            item.nominal,
          ],
        );

        // 5. Piutang Detail Penjualan
        let cpdidrec = `${cabang}INV${format(
          new Date(),
          "yyyyMMddHHmmssSSS",
        )}D`;
        await connection.query(
          'INSERT INTO tpiutang_dtl (pd_sd_angsur, pd_ph_nomor, pd_tanggal, pd_uraian, pd_debet, pd_kredit, pd_ket) VALUES (?, ?, ?, "Penjualan", ?, 0, "")',
          [
            cpdidrec,
            `${ckdcus}${cklerek}`,
            invHeader.inv_tanggal,
            item.nominal,
          ],
        );

        let csetornew = "";
        if (invHeader.inv_rpcard == 0) {
          // 6a. Bayar Tunai
          cpdidrec = `${cabang}CASH${format(new Date(), "yyyyMMddHHmmssSSS")}D`;
          await connection.query(
            'INSERT INTO tpiutang_dtl (pd_sd_angsur, pd_ph_nomor, pd_tanggal, pd_uraian, pd_debet, pd_kredit, pd_ket) VALUES (?, ?, ?, "Bayar Tunai Langsung", 0, ?, "")',
            [
              cpdidrec,
              `${ckdcus}${cklerek}`,
              invHeader.inv_tanggal,
              item.nominal,
            ],
          );
        } else {
          // 6b. Bayar Card
          csetornew = `${setorPrefix}${String(nextSetorNum).padStart(4, "0")}`;
          nextSetorNum++;
          const cshidrec = `${cabang}SH${format(
            new Date(),
            "yyyyMMddHHmmssSSS",
          )}`;

          // Setor Header
          await connection.query(
            `INSERT INTO tsetor_hdr (sh_idrec, sh_nomor, sh_tanggal, sh_jenis, sh_nominal, sh_akun, sh_norek, sh_tgltransfer, sh_cus_kode, sh_otomatis, sh_ket, user_create, date_create) 
                         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, "Y", "", ?, ?)`,
            [
              cshidrec,
              csetornew,
              invHeader.inv_tanggal,
              invHeader.inv_rpcard,
              invHeader.rek_kode,
              invHeader.inv_nocard,
              invHeader.inv_tanggal,
              invHeader.Inv_cus_kode_safe,
              invHeader.user_create,
              invHeader.date_create,
            ],
          );

          // Setor Detail
          const cAngsur = `${cabang}SD${format(
            new Date(),
            "yyyyMMddHHmmssSSS",
          )}`;
          await connection.query(
            'INSERT INTO tsetor_dtl (sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur, sd_nourut) VALUES (?, ?, ?, ?, ?, "PEMBAYARAN DARI KASIR", ?, 1)',
            [
              cshidrec,
              csetornew,
              invHeader.inv_tanggal,
              cklerek,
              invHeader.inv_rpcard,
              cAngsur,
            ],
          );

          // Link Bayar ke Piutang
          await connection.query(
            'INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur) VALUES (?, ?, "Pembayaran Card", ?, ?, ?)',
            [
              `${ckdcus}${cklerek}`,
              invHeader.inv_tanggal,
              invHeader.inv_rpcard,
              csetornew,
              cAngsur,
            ],
          );

          // Update inv_hdr permanen
          await connection.query(
            "UPDATE tinv_hdr SET inv_nosetor = ? WHERE inv_klerek = ?",
            [csetornew, cnomor],
          );
        }

        // 7. Update inv_hdr_tmp
        await connection.query(
          "UPDATE tinv_hdr_tmp SET inv_klerek = ? WHERE inv_id = ?",
          [cklerek, cnomor],
        );

        // 8. Insert Detail
        const [tsql2] = await connection.query(
          "SELECT d.*, b.brgd_hpp FROM tinv_dtl_tmp d LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.invd_kode AND b.brgd_ukuran = d.invd_ukuran WHERE invd_inv_nomor = ?",
          [invHeader.inv_nomor],
        );

        for (const dtl of tsql2) {
          await connection.query(
            "INSERT INTO tinv_dtl (invd_idrec, Invd_Inv_nomor, Invd_kode, invd_ukuran, Invd_jumlah, invd_harga, invd_hpp, invd_disc, invd_diskon, invd_pro_nomor, invd_nourut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              cidrec,
              cklerek,
              dtl.invd_kode, // GUNAKAN HURUF KECIL (invd_kode)
              dtl.invd_ukuran, // Sesuai dengan hasil SELECT d.*
              dtl.invd_jumlah, // Sesuai dengan hasil SELECT d.*
              dtl.invd_harga,
              dtl.brgd_hpp || 0, // Tambahkan fallback 0 jika HPP kosong
              dtl.invd_disc,
              dtl.invd_diskon,
              dtl.invd_pro_nomor,
              dtl.invd_nourut,
            ],
          );
        }

        processedCount++;
      }
    }

    await connection.commit();
    return { message: `${processedCount} invoice berhasil di-klerek.` };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Mengambil opsi filter cabang.
 * Diperbarui: KDC bisa melihat SEMUA cabang.
 */
const getCabangOptions = async (user) => {
  let query;
  const params = [];
  if (user.cabang === "KDC") {
    // KDC bisa melihat semua cabang (sesuai permintaan "tampilkan semua aja")
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY kode";
  } else {
    // Cabang biasa hanya melihat cabangnya sendiri
    query =
      "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode = ?";
    params.push(user.cabang);
  }
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  prosesKlerek,
  getCabangOptions,
};
