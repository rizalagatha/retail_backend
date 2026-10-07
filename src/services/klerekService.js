const pool = require("../config/database");
const { isDate, format, parseISO } = require("date-fns");

// Helper: getmaxnomor2
const generateNewInvNomor = async (connection, tanggal, cabang) => {
  const ayymm = format(new Date(tanggal), "yyMM");
  const prefix = `${cabang}.INV.${ayymm}.`;

  // Perbaikan: Gunakan LIKE dan CAST ke UNSIGNED untuk akurasi
  const [rows] = await connection.query(
    "SELECT IFNULL(MAX(CAST(RIGHT(inv_nomor, 4) AS UNSIGNED)), 0) as max_nomor FROM tinv_hdr WHERE inv_nomor LIKE ?",
    [`${prefix}%`],
  );
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// Helper: getsetor2
const generateNewSetorNomor = async (connection, tanggal, cabang) => {
  const ayymm = format(new Date(tanggal), "yyMM");
  const prefix = `${cabang}.STR.${ayymm}.`;

  // Perbaikan: Gunakan LIKE dan CAST
  const [rows] = await connection.query(
    "SELECT IFNULL(MAX(CAST(RIGHT(sh_nomor, 4) AS UNSIGNED)), 0) as max_nomor FROM tsetor_hdr WHERE sh_nomor LIKE ?",
    [`${prefix}%`],
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
  if (!Array.isArray(items) || items.length === 0) {
    return {
      message: "Tidak ada data.",
      processed: 0,
      skipped: [],
      warnings: [],
    };
  }

  // Cabang mengikuti user (KDC boleh memilih), bukan dipercaya dari klien
  const finalCabang = user.cabang === "KDC" ? cabang : user.cabang;
  if (!finalCabang) throw new Error("Cabang harus dipilih.");

  // ID unik berbasis milidetik yang selalu naik, panjangnya sama dengan format lama
  let lastMs = 0;
  const uid = (tag) => {
    let ms = Date.now();
    if (ms <= lastMs) ms = lastMs + 1;
    lastMs = ms;
    return `${finalCabang}${tag}${format(new Date(ms), "yyyyMMddHHmmssSSS")}`;
  };

  const toDate = (v) => (isDate(v) ? v : parseISO(String(v)));
  const round = (n) => Math.round(Number(n) || 0);

  const connection = await pool.getConnection();
  const processed = [];
  const skipped = [];
  const warnings = [];

  // Counter nomor per prefix (invoice & setoran), dikunci sekali per prefix
  let counters = new Map();
  const peekNumber = async (table, col, prefix) => {
    if (!counters.has(prefix)) {
      const [rows] = await connection.query(
        `SELECT IFNULL(MAX(CAST(RIGHT(${col}, 4) AS UNSIGNED)), 0) AS m FROM ${table} WHERE ${col} LIKE ? FOR UPDATE`,
        [`${prefix}%`],
      );
      counters.set(prefix, Number(rows[0].m));
    }
    return `${prefix}${String(counters.get(prefix) + 1).padStart(4, "0")}`;
  };
  const bumpNumber = (prefix) => counters.set(prefix, counters.get(prefix) + 1);

  try {
    await connection.beginTransaction();

    // Nomor inv_id unik dari klien, hanya dipakai sebagai kunci pencarian
    const invIds = [
      ...new Set(
        items.map((i) => String(i?.nomor || "").trim()).filter(Boolean),
      ),
    ];

    for (let idx = 0; idx < invIds.length; idx++) {
      const invId = invIds[idx];
      const savepoint = `sp_klerek_${idx}`;
      const counterSnapshot = new Map(counters);
      await connection.query(`SAVEPOINT ${savepoint}`);

      try {
        // 1. Header tmp, dikunci agar tidak diklerek dua kali
        const [hdrRows] = await connection.query(
          "SELECT * FROM tinv_hdr_tmp WHERE inv_id = ? FOR UPDATE",
          [invId],
        );
        if (hdrRows.length === 0) {
          skipped.push({ nomor: invId, alasan: "Invoice tidak ditemukan." });
          continue;
        }
        const h = hdrRows[0];

        if (String(h.inv_nomor || "").slice(0, 3) !== finalCabang) {
          skipped.push({ nomor: invId, alasan: "Bukan invoice cabang ini." });
          continue;
        }
        if (h.inv_klerek && h.inv_klerek !== "0") {
          skipped.push({
            nomor: invId,
            alasan: `Sudah diklerek (${h.inv_klerek}).`,
          });
          continue;
        }

        const tgl = toDate(h.inv_tanggal);
        const ayymm = format(tgl, "yyMM");
        const cusKode = h.inv_cus_kode || "";

        // 2. Detail tmp. invd_kode di tmp bisa berisi barcode, jadi dipetakan ke kode + ukuran asli
        const [dtlRows] = await connection.query(
          `SELECT d.*,
                  COALESCE(bb.brgd_kode, bk.brgd_kode)     AS kode_real,
                  COALESCE(bb.brgd_ukuran, bk.brgd_ukuran) AS ukuran_real,
                  COALESCE(bb.brgd_hpp, bk.brgd_hpp, 0)    AS hpp_real
             FROM tinv_dtl_tmp d
             LEFT JOIN tbarangdc_dtl bb ON TRIM(bb.brgd_barcode) = TRIM(d.invd_kode)
             LEFT JOIN tbarangdc_dtl bk ON bk.brgd_kode = d.invd_kode AND bk.brgd_ukuran = d.invd_ukuran
            WHERE d.invd_inv_nomor = ?
            ORDER BY d.invd_nourut`,
          [h.inv_nomor],
        );
        if (dtlRows.length === 0) {
          skipped.push({ nomor: invId, alasan: "Detail barang kosong." });
          continue;
        }
        const tidakDikenal = dtlRows.filter((d) => !d.kode_real);
        if (tidakDikenal.length > 0) {
          throw new Error(
            `Barang tidak dikenali: ${tidakDikenal.map((d) => d.invd_kode).join(", ")}.`,
          );
        }

        // 3. Hitung ulang nilai tagihan dari DB (tidak percaya nominal klien)
        const subtotal = dtlRows.reduce(
          (s, d) =>
            s +
            Number(d.invd_jumlah) *
              (Number(d.invd_harga) - Number(d.invd_diskon)),
          0,
        );
        const dasar = subtotal - Number(h.inv_disc || 0);
        const nominal = round(dasar + (Number(h.inv_ppn || 0) / 100) * dasar);
        const biayaKirim = round(h.inv_bkrm);
        const tagihan = nominal + biayaKirim;

        // 4. Komponen pembayaran
        const rpCard = round(h.inv_rpcard);
        const rpVoucher = round(h.inv_rpvoucher);
        const rpRetur = round(h.inv_rj_rp);
        const kembali = round(h.inv_kembali);
        const pundiAmal = round(h.inv_pundiamal);

        // DP hanya dihitung bila setoran DP aslinya ada
        let dpPakai = 0;
        let dpSetorIdrec = null;
        if (round(h.inv_dp) > 0 && h.inv_nodp) {
          const [dpHdr] = await connection.query(
            "SELECT sh_idrec FROM tsetor_hdr WHERE sh_nomor = ?",
            [h.inv_nodp],
          );
          if (dpHdr.length > 0) {
            dpPakai = Math.min(round(h.inv_dp), tagihan);
            dpSetorIdrec = dpHdr[0].sh_idrec;
          } else {
            warnings.push(
              `${h.inv_nomor}: setoran DP ${h.inv_nodp} tidak ditemukan, DP tidak ditautkan.`,
            );
          }
        }

        // Tunai bersih = sisa tagihan setelah semua pembayaran non-tunai (sama seperti saveData)
        const bayarTunaiBersih = Math.max(
          tagihan - dpPakai - rpCard - rpVoucher - rpRetur,
          0,
        );

        // Cross-check dengan angka tunai yang tercatat di tmp
        const tunaiTercatat = Math.max(
          round(h.inv_rptunai) - kembali - pundiAmal,
          0,
        );
        if (Math.abs(tunaiTercatat - bayarTunaiBersih) > 1) {
          warnings.push(
            `${h.inv_nomor}: tunai dihitung ${bayarTunaiBersih} vs tercatat ${tunaiTercatat}. Cek manual.`,
          );
        }

        const invBayar =
          dpPakai +
          bayarTunaiBersih +
          kembali +
          pundiAmal +
          rpCard +
          rpVoucher +
          rpRetur;

        // 5. Nomor invoice & setoran
        const invPrefix = `${finalCabang}.INV.${ayymm}.`;
        const setorPrefix = `${finalCabang}.STR.${ayymm}.`;

        const cklerek = await peekNumber("tinv_hdr", "inv_nomor", invPrefix);
        bumpNumber(invPrefix);

        let nomorSetorCard = "";
        if (rpCard > 0) {
          nomorSetorCard = await peekNumber(
            "tsetor_hdr",
            "sh_nomor",
            setorPrefix,
          );
          bumpNumber(setorPrefix);
        }

        // Tunai: cabang KDC tidak punya setoran kasir (sama seperti saveData)
        let nomorSetorTunai = "";
        if (bayarTunaiBersih > 0 && finalCabang !== "KDC") {
          nomorSetorTunai = await peekNumber(
            "tsetor_hdr",
            "sh_nomor",
            setorPrefix,
          );
          bumpNumber(setorPrefix);
        }

        const nomorSetorUtama =
          nomorSetorCard || nomorSetorTunai || h.inv_nosetor || "";
        const piutangNomor = `${cusKode}${cklerek}`;
        const idrec = uid("INV");

        // 6. Header permanen
        await connection.query("INSERT INTO tinv_hdr SET ?", [
          {
            inv_idrec: idrec,
            inv_nomor: cklerek,
            inv_nomor_so: h.inv_nomor_so,
            inv_klerek: invId,
            inv_tanggal: h.inv_tanggal,
            inv_cab: finalCabang,
            inv_cus_kode: cusKode,
            inv_cus_level: h.inv_cus_level,
            inv_top: h.inv_top || 0,
            inv_ppn: h.inv_ppn,
            inv_disc: h.inv_disc,
            inv_disc1: h.inv_disc1,
            inv_disc2: h.inv_disc2,
            inv_bkrm: h.inv_bkrm,
            inv_dp: dpPakai,
            inv_nodp: dpPakai > 0 ? h.inv_nodp : "",
            inv_pro_nomor: h.inv_pro_nomor,
            inv_ket: h.inv_nomor || "",
            inv_bayar: invBayar,
            inv_pundiamal: pundiAmal,
            inv_kembali: kembali,
            inv_rptunai: bayarTunaiBersih,
            inv_novoucher: h.inv_novoucher,
            inv_rpvoucher: rpVoucher,
            inv_rpcard: rpCard,
            inv_nosetor: nomorSetorUtama,
            inv_rj_nomor: h.inv_rj_nomor || "",
            inv_rj_rp: rpRetur,
            inv_mem_hp: h.inv_mem_hp,
            inv_mem_nama: h.inv_mem_nama,
            inv_mem_alamat: h.inv_mem_alamat,
            inv_mem_gender: h.inv_mem_gender,
            inv_mem_usia: h.inv_mem_usia,
            inv_mem_referensi: h.inv_mem_referensi,
            inv_print: h.inv_print,
            inv_puas: h.inv_puas,
            inv_closing: h.inv_closing,
            user_create: h.user_create,
            date_create: h.date_create,
            user_modified: user.kode,
            date_modified: new Date(),
          },
        ]);

        // 7. Detail permanen. invd_mststok memicu pemotongan stok rak (sama seperti saveData tanpa SO)
        const detailValues = dtlRows.map((d, i) => [
          `${cklerek.replace(/\./g, "")}${String(i + 1).padStart(3, "0")}`,
          cklerek,
          d.kode_real,
          d.ukuran_real,
          d.invd_jumlah,
          0, // invd_mstpesan: penjualan bazar tidak memakai SO
          d.invd_jumlah, // invd_mststok
          d.invd_harga,
          d.hpp_real,
          d.invd_disc,
          d.invd_diskon,
          d.invd_pro_nomor,
          d.invd_nourut,
        ]);
        await connection.query(
          `INSERT INTO tinv_dtl
             (invd_idrec, invd_inv_nomor, invd_kode, invd_ukuran, invd_jumlah,
              invd_mstpesan, invd_mststok,
              invd_harga, invd_hpp, invd_disc, invd_diskon, invd_pro_nomor, invd_nourut)
           VALUES ?`,
          [detailValues],
        );

        // 8. Piutang header + kartu piutang
        await connection.query(
          `INSERT INTO tpiutang_hdr (ph_nomor, ph_tanggal, ph_cus_kode, ph_inv_nomor, ph_top, ph_nominal, ph_flag, ph_cab)
           VALUES (?, ?, ?, ?, 0, ?, 0, ?)
           ON DUPLICATE KEY UPDATE ph_nominal = VALUES(ph_nominal)`,
          [piutangNomor, h.inv_tanggal, cusKode, cklerek, tagihan, finalCabang],
        );

        const piutangRows = [];
        const addPiutang = (angsur, uraian, debet, kredit, ket) =>
          piutangRows.push([
            angsur,
            piutangNomor,
            h.inv_tanggal,
            uraian,
            debet,
            kredit,
            ket || "",
          ]);

        addPiutang(uid("INV"), "Penjualan", nominal, 0, "");
        if (biayaKirim > 0)
          addPiutang(uid("KRM"), "Biaya Kirim", biayaKirim, 0, "");

        if (bayarTunaiBersih > 0) {
          addPiutang(
            uid("CASH"),
            "Bayar Tunai Langsung",
            0,
            bayarTunaiBersih,
            nomorSetorTunai,
          );
        }
        if (rpVoucher > 0) {
          addPiutang(
            uid("VOU"),
            "Bayar Voucher",
            0,
            rpVoucher,
            h.inv_novoucher || "",
          );
        }
        if (rpRetur > 0) {
          addPiutang(
            uid("RJ"),
            "Pembayaran Retur",
            0,
            rpRetur,
            h.inv_rj_nomor || "",
          );
        }

        // 9. Setoran tunai (baru)
        if (nomorSetorTunai) {
          const idrecTunai = `${uid("SH")}T`;
          await connection.query(
            `INSERT INTO tsetor_hdr
               (sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal,
                sh_otomatis, sh_ket, sh_cab, user_create, date_create)
             VALUES (?, ?, ?, ?, 0, ?, 'Y', 'PEMBAYARAN TUNAI KASIR', ?, ?, ?)`,
            [
              idrecTunai,
              nomorSetorTunai,
              cusKode,
              h.inv_tanggal,
              bayarTunaiBersih,
              finalCabang,
              h.user_create,
              h.date_create,
            ],
          );
          await connection.query(
            `INSERT INTO tsetor_dtl (sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur, sd_nourut)
             VALUES (?, ?, ?, ?, ?, 'PEMBAYARAN TUNAI KASIR', ?, 1)`,
            [
              idrecTunai,
              nomorSetorTunai,
              h.inv_tanggal,
              cklerek,
              bayarTunaiBersih,
              uid("CT"),
            ],
          );
        }

        // 10. Setoran card
        if (nomorSetorCard) {
          const [rekRows] = await connection.query(
            "SELECT rek_kode FROM finance.trekening WHERE rek_rekening = ? LIMIT 1",
            [h.inv_nocard],
          );
          if (rekRows.length === 0 || !rekRows[0].rek_kode) {
            throw new Error(
              `Rekening "${h.inv_nocard}" belum terdaftar di master rekening.`,
            );
          }
          const idrecCard = uid("SH");
          const angsurCard = uid("SD");
          await connection.query(
            `INSERT INTO tsetor_hdr
               (sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal, sh_akun, sh_norek,
                sh_tgltransfer, sh_otomatis, sh_ket, sh_cab, user_create, date_create)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'Y', '', ?, ?, ?)`,
            [
              idrecCard,
              nomorSetorCard,
              cusKode,
              h.inv_tanggal,
              rpCard,
              rekRows[0].rek_kode,
              h.inv_nocard,
              h.inv_tanggal,
              finalCabang,
              h.user_create,
              h.date_create,
            ],
          );
          await connection.query(
            `INSERT INTO tsetor_dtl (sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur, sd_nourut)
             VALUES (?, ?, ?, ?, ?, 'PEMBAYARAN DARI KASIR', ?, 1)`,
            [
              idrecCard,
              nomorSetorCard,
              h.inv_tanggal,
              cklerek,
              rpCard,
              angsurCard,
            ],
          );
          addPiutang(angsurCard, "Pembayaran Card", 0, rpCard, nomorSetorCard);
        }

        // 11. Tautan DP (sama seperti penautan DP di saveData)
        if (dpPakai > 0 && dpSetorIdrec) {
          const angsurDp = uid("DP");
          await connection.query(
            `INSERT INTO tsetor_dtl (sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur)
             VALUES (?, ?, ?, ?, ?, 'DP LINK DARI INV', ?)`,
            [
              dpSetorIdrec,
              h.inv_nodp,
              h.inv_tanggal,
              cklerek,
              dpPakai,
              angsurDp,
            ],
          );
          addPiutang(angsurDp, "DP", 0, dpPakai, h.inv_nodp);
        }

        await connection.query(
          `INSERT INTO tpiutang_dtl (pd_sd_angsur, pd_ph_nomor, pd_tanggal, pd_uraian, pd_debet, pd_kredit, pd_ket)
           VALUES ?`,
          [piutangRows],
        );

        // 12. Tandai tmp sudah diklerek
        await connection.query(
          "UPDATE tinv_hdr_tmp SET inv_klerek = ?, inv_nosetor = ? WHERE inv_id = ?",
          [cklerek, nomorSetorUtama, invId],
        );

        processed.push(cklerek);
      } catch (err) {
        // Gagal satu invoice tidak menggagalkan batch; nomor dikembalikan
        await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        counters = counterSnapshot;
        skipped.push({ nomor: invId, alasan: err.message });
      }
    }

    await connection.commit();
    return {
      message: `${processed.length} invoice berhasil di-klerek, ${skipped.length} dilewati.`,
      processed: processed.length,
      skipped,
      warnings,
    };
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
