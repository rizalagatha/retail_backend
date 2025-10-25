const pool = require("../config/database");
const { format, addDays } = require("date-fns");

/**
 * Helper: Mengambil nomor baru (getmaxnomor)
 *
 */
const generateNewNomor = async (connection, gudangKode, tanggal) => {
  const ayymm = format(new Date(tanggal), "yyMM");
  const prefix = `${gudangKode}.POT.${ayymm}.`;
  const query = `SELECT IFNULL(MAX(RIGHT(pt_nomor, 4)), 0) as max_nomor FROM tpotongan_hdr WHERE LEFT(pt_nomor, 12) = ?`;
  const [rows] = await connection.query(query, [prefix]);
  const nextNum = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

/**
 * Mengambil data awal untuk form (dari FormShow)
 *
 */
const getInitialData = async (user) => {
  const [gudangRows] = await pool.query(
    "SELECT gdg_kode, gdg_nama FROM tgudang WHERE gdg_kode = ?",
    [user.cabang]
  );
  return {
    gudang: {
      kode: gudangRows[0]?.gdg_kode || user.cabang,
      nama: gudangRows[0]?.gdg_nama || "GUDANG TIDAK DIKENALI",
    },
    akun: {
      kode: "D-111198",
      nama: "POTONGAN PENJUALAN KENCANA PRINT",
      rekening: "003",
    },
  };
};

/**
 * Mengambil data Customer (F1 di edtCus)
 *
 */
const getCustomerLookup = async (user) => {
  const query = `
        SELECT 
            c.cus_kode AS kode,
            IFNULL((
                SELECT l.level_nama
                FROM tcustomer_level_history v
                LEFT JOIN tcustomer_level l ON l.level_kode = v.clh_level
                WHERE v.clh_cus_kode = c.cus_kode
                ORDER BY v.clh_tanggal DESC LIMIT 1
            ), "") AS \`level\`,
            c.cus_telp AS telp,
            c.cus_nama AS nama,
            c.cus_alamat AS alamat,
            c.cus_kota AS kota
        FROM tcustomer c 
        WHERE c.cus_aktif = 0
        ORDER BY c.cus_nama
    `;
  const [rows] = await pool.query(query);
  return rows;
};

/**
 * Mengambil data Piutang/Invoice (F1 di grid)
 * Menerjemahkan BantuanInvoive
 */
const getInvoiceLookup = async (customerKode, gudangKode) => {
  const query = `
        SELECT x.Invoice, x.TglInvoice, x.Top, x.JatuhTempo, x.Nominal, x.Bayar, (x.Nominal - x.Bayar) AS Sisa
        FROM (
            SELECT 
                h.ph_inv_nomor AS Invoice,
                h.ph_tanggal AS TglInvoice,
                h.ph_top AS Top, 
                DATE_ADD(h.ph_tanggal, INTERVAL h.ph_top DAY) AS JatuhTempo,
                h.ph_nominal AS Nominal,
                IFNULL((SELECT SUM(d.pd_kredit) FROM tpiutang_dtl d WHERE d.pd_ph_nomor = h.ph_nomor), 0) AS Bayar
            FROM tpiutang_hdr h
            WHERE h.ph_cus_kode = ? AND LEFT(h.ph_inv_nomor, 3) = ?
        ) X
        WHERE (X.Nominal - X.Bayar) <> 0
        ORDER BY X.TglInvoice
    `;
  const [rows] = await pool.query(query, [customerKode, gudangKode]);
  return rows.map((row) => ({
    invoice: row.Invoice,
    tanggalInvoice: row.TglInvoice,
    top: row.Top,
    jatuhTempo: row.JatuhTempo,
    nominalInvoice: row.Nominal,
    terbayarPiutang: row.Bayar,
    sisaPiutang: row.Sisa,
  }));
};

/**
 * Mengambil data Potongan untuk mode Ubah (loaddataall)
 *
 */
const getDataForEdit = async (nomor) => {
  const query = `
        SELECT 
            h.pt_nomor, h.pt_tanggal, h.pt_nominal, h.pt_akun,
            g.gdg_kode, g.gdg_nama,
            c.cus_kode, c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
            r.rek_nama, r.rek_rekening,
            d.ptd_inv, d.ptd_tanggal AS tglBayar, d.ptd_bayar AS bayar, d.ptd_angsur,
            p.ph_tanggal, IFNULL(p.ph_top, 0) AS ph_top, IFNULL(p.ph_nominal, 0) AS ph_nominal,
            IFNULL(q.mBayar, 0) AS mBayar,
            IFNULL((p.ph_nominal - q.mBayar), 0) AS sisa
        FROM tpotongan_hdr h
        LEFT JOIN tpotongan_dtl d ON d.ptd_nomor = h.pt_nomor
        LEFT JOIN tgudang g ON g.gdg_kode = LEFT(h.pt_nomor, 3)
        LEFT JOIN tpiutang_hdr p ON p.ph_inv_nomor = d.ptd_inv
        LEFT JOIN (
            SELECT pd_ph_nomor, SUM(pd_kredit) mBayar FROM tpiutang_dtl GROUP BY pd_ph_nomor
        ) q ON q.pd_ph_nomor = p.ph_nomor
        LEFT JOIN tcustomer c ON c.cus_kode = h.pt_cus_kode
        LEFT JOIN finance.trekening r ON r.rek_kode = h.pt_akun
        WHERE h.pt_nomor = ?
        ORDER BY d.ptd_angsur
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Nomor tersebut tidak ditemukan.");

  const header = {
    nomor: rows[0].pt_nomor,
    tanggal: format(new Date(rows[0].pt_tanggal), "yyyy-MM-dd"),
    gudang: { kode: rows[0].gdg_kode, nama: rows[0].gdg_nama },
    customer: {
      kode: rows[0].cus_kode,
      nama: rows[0].cus_nama,
      alamat: rows[0].cus_alamat,
      kota: rows[0].cus_kota,
      telp: rows[0].cus_telp,
      level: "", // Anda bisa tambahkan query level jika perlu
    },
    nominalPotongan: rows[0].pt_nominal,
    akun: {
      kode: rows[0].pt_akun,
      nama: rows[0].rek_nama,
      rekening: rows[0].rek_rekening,
    },
    sisaPotongan: 0, // Akan dihitung di frontend
    totalTerbayar: 0, // Akan dihitung di frontend
  };

  const details = rows
    .filter((row) => row.ptd_inv)
    .map((row) => ({
      invoice: row.ptd_inv,
      tanggalInvoice: row.ph_tanggal,
      top: row.ph_top,
      jatuhTempo: addDays(new Date(row.ph_tanggal), row.ph_top),
      nominalInvoice: row.ph_nominal,
      terbayarPiutang: row.mBayar,
      sisaPiutang: row.sisa,
      bayar: row.bayar,
      tglBayar: row.tglBayar,
      angsuranId: row.ptd_angsur,
    }));

  return { header, details };
};

/**
 * Menyimpan data Potongan (simpandata)
 *
 */
const saveData = async (data, user) => {
  const { header, details, isEditMode } = data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let ptNomor = header.nomor;
    if (!isEditMode) {
      ptNomor = await generateNewNomor(
        connection,
        header.gudang.kode,
        header.tanggal
      );
    }

    if (isEditMode) {
      await connection.query(
        `UPDATE tpotongan_hdr SET 
                    pt_tanggal = ?, pt_nominal = ?, pt_akun = ?, 
                    user_modified = ?, date_modified = NOW() 
                 WHERE pt_nomor = ?`,
        [
          header.tanggal,
          header.nominalPotongan,
          header.akun.kode,
          user.kode,
          ptNomor,
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO tpotongan_hdr 
                    (pt_nomor, pt_cus_kode, pt_tanggal, pt_akun, pt_nominal, user_cab, user_create, date_create) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          ptNomor,
          header.customer.kode,
          header.tanggal,
          header.akun.kode,
          header.nominalPotongan,
          user.cabang,
          user.kode,
        ]
      );
    }

    // Hapus detail lama
    await connection.query("DELETE FROM tpotongan_dtl WHERE ptd_nomor = ?", [
      ptNomor,
    ]);

    // Hapus dari tpiutang_dtl (ROLLBACK)
    await connection.query("DELETE FROM tpiutang_dtl WHERE pd_ket = ?", [
      ptNomor,
    ]);

    // Insert detail baru
    for (const item of details) {
      if (item.invoice && item.bayar > 0) {
        // Insert ke tpotongan_dtl
        await connection.query(
          "INSERT INTO tpotongan_dtl (ptd_nomor, ptd_tanggal, ptd_inv, ptd_bayar, ptd_angsur) VALUES (?, ?, ?, ?, ?)",
          [ptNomor, item.tglBayar, item.invoice, item.bayar, item.angsuranId]
        );

        // Insert ke tpiutang_dtl
        await connection.query(
          'INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur) VALUES (?, ?, "Potongan", ?, ?, ?)',
          [
            `${header.customer.kode}${item.invoice}`,
            item.tglBayar,
            item.bayar,
            ptNomor,
            item.angsuranId,
          ]
        );
      }
    }

    await connection.commit();

    // TODO: Jalankan Syncho.exe jika diperlukan
    // const ccab = header.gudang.kode;
    // if (['K02','K03','K04','K05','K06','K07','K08'].includes(ccab)) {
    //     // Panggil logika sinkronisasi di sini
    // }

    return {
      message: `Transaksi Potongan ${ptNomor} berhasil disimpan.`,
      nomor: ptNomor,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  getInitialData,
  getCustomerLookup,
  getInvoiceLookup,
  getDataForEdit,
  saveData,
};
