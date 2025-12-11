const pool = require("../config/database");
const { format } = require("date-fns");

// --- HELPER FUNCTIONS ---
const generateMsoNumber = async (connection, gudang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${gudang}MSO${format(date, "yyMM")}`;
  const query = `SELECT IFNULL(MAX(RIGHT(mso_nomor, 5)), 0) + 1 AS next_num FROM tmutasistok_hdr WHERE mso_nomor LIKE ?`;
  const [rows] = await connection.query(query, [`${prefix}%`]);
  return `${prefix}${rows[0].next_num.toString().padStart(5, "0")}`;
};

const generateMsodNomorIn = async (connection, gudang, tanggal) => {
  const aym = format(new Date(tanggal), "yyMM");
  const prefix = `${gudang}MSI${aym}`;
  const query = `SELECT IFNULL(MAX(RIGHT(msod_nomorin, 5)), 0) + 1 AS next_num FROM tmutasistok_dtl WHERE LEFT(msod_nomorin, 10) = ?`;
  const [rows] = await connection.query(query, [prefix]);
  return `${prefix}${rows[0].next_num.toString().padStart(5, "0")}`;
};

// [FIX] Helper Aman untuk Update Stok (Tanpa mst_id)
// Tambahkan rule: jika gudang = 'KON' dan type = 'IN', stok tidak berubah (virtual only)
const updateStockSafe = async (
  connection,
  gudang,
  kode,
  ukuran,
  qty,
  type = "IN"
) => {
  // Jika virtual move ke gudang KON → stok tidak berubah
  if (gudang === "KON" && type === "IN") {
    // skip completely, tapi tidak error
    return;
  }

  // === lanjut seperti biasa ===

  const [rows] = await connection.query(
    `SELECT mst_cab FROM tmasterstok WHERE mst_cab = ? AND mst_brg_kode = ? AND mst_ukuran = ?`,
    [gudang, kode, ukuran]
  );

  if (rows.length > 0) {
    const field = type === "IN" ? "mst_stok_in" : "mst_stok_out";

    await connection.query(
      `UPDATE tmasterstok SET ${field} = ${field} + ? 
       WHERE mst_cab = ? AND mst_brg_kode = ? AND mst_ukuran = ?`,
      [qty, gudang, kode, ukuran]
    );
  } else {
    const stokIn = type === "IN" ? qty : 0;
    const stokOut = type === "OUT" ? qty : 0;

    await connection.query(
      `INSERT INTO tmasterstok (mst_cab, mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_aktif)
       VALUES (?, ?, ?, ?, ?, 'Y')`,
      [gudang, kode, ukuran, stokIn, stokOut]
    );
  }
};

// --- CORE LOGIC ---

const savePesanan = async (payload, user) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const {
      sourceGudang, // Gudang Fisik (K01/KDC)
      targetGudang = "KON", // Gudang Maya (Online)
      tanggal,
      mpInfo, // { mpNama, noPesanan, noResi, customerKode, biayaPlatform }
      items, // Array Item
    } = payload;

    // ===============================
    // VALIDASI INPUT
    // ===============================

    if (!mpInfo.noPesanan) {
      throw new Error("Nomor Pesanan wajib diisi.");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Item pesanan tidak boleh kosong.");
    }

    for (const it of items) {
      if (!it.kode || !it.ukuran) {
        throw new Error(`Item tidak valid (kode/ukuran kosong).`);
      }
      if (!it.jumlah || Number(it.jumlah) <= 0) {
        throw new Error(`Qty item ${it.kode} harus lebih dari 0.`);
      }
    }

    // ===============================
    // CEK ORDER SUDAH PERNAH DIPROSES
    // ===============================

    const [exists] = await connection.query(
      `
        SELECT mso_nomor
        FROM tmutasistok_hdr 
        WHERE mso_ket LIKE ? 
          AND mso_jenis = ?
          AND mso_cab = ?
        LIMIT 1
      `,
      [`%${mpInfo.noPesanan}%`, mpInfo.mpNama.toUpperCase(), sourceGudang]
    );

    if (exists.length > 0) {
      throw new Error(
        `Pesanan ${mpInfo.noPesanan} (${mpInfo.mpNama}) sudah pernah diproses. Mutasi: ${exists[0].mso_nomor}`
      );
    }

    const tglSql = format(new Date(tanggal), "yyyy-MM-dd");
    const nowTs = format(new Date(), "yyyyMMddHHmmssSSS");

    // =================================================================
    // LANGKAH 1: PROSES MUTASI STOK (Barang Fisik Keluar -> Masuk KON)
    // =================================================================

    const noMutasi = await generateMsoNumber(connection, sourceGudang, tanggal);
    const msodNomorIn = await generateMsodNomorIn(
      connection,
      targetGudang,
      tanggal
    );
    const idrecMso = `${sourceGudang}MSO${nowTs}`;

    // Info Fee & Resi disimpan di Keterangan karena tabel tidak support kolom khusus
    const infoKet = `PESANAN: ${mpInfo.noPesanan} || FEE:${
      mpInfo.biayaPlatform || 0
    }`;

    // 1.A Insert Header Mutasi
    // (Kolom mso_ke dan mso_dari dihapus sesuai error sebelumnya)
    await connection.query(
      `INSERT INTO tmutasistok_hdr (
         mso_idrec, mso_nomor, mso_tanggal, 
         mso_cab,        -- Gudang Asal
         mso_jenis,      -- Marketplace
         mso_ket,        -- Keterangan
         user_create, date_create
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        idrecMso,
        noMutasi,
        tglSql,
        sourceGudang,
        mpInfo.mpNama.toUpperCase(),
        infoKet,
        user.kode,
      ]
    );

    let urutMso = 1;

    for (const item of items) {
      const qty = Number(item.jumlah);

      // 1.B Insert Detail Mutasi
      await connection.query(
        `INSERT INTO tmutasistok_dtl (
            msod_idrec, msod_nomor, msod_nomorin, 
            msod_kode, msod_ukuran, msod_jumlah, msod_nourut
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `${idrecMso}${urutMso}`,
          noMutasi,
          msodNomorIn,
          item.kode,
          item.ukuran,
          qty,
          urutMso,
        ]
      );

      // 1.C Update Stok GUDANG SUMBER (K01) -> Berkurang (OUT)
      await updateStockSafe(
        connection,
        sourceGudang,
        item.kode,
        item.ukuran,
        qty,
        "OUT"
      );

      // 1.D Update Stok GUDANG ONLINE (KON) -> Bertambah (IN)
      // [FIX] Menggunakan fungsi helper aman, bukan ON DUPLICATE KEY
      await updateStockSafe(
        connection,
        targetGudang,
        item.kode,
        item.ukuran,
        qty,
        "IN"
      );

      urutMso++;
    }

    // CATATAN:
    // Tidak ada pembuatan Invoice & Piutang di sini.
    // Invoice dibuat terpisah di menu "Buat Invoice" -> "Cari Pesanan".

    await connection.commit();

    return {
      message: "Pesanan disimpan. Stok telah dimutasi ke Online.",
      data: { mutasi: noMutasi },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// [BARU] Ambil Opsi Gudang (K01 & KDC)
const getSourceGudangList = async () => {
  const query = `SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode IN ('K01', 'KDC') ORDER BY gdg_kode ASC`;
  const [rows] = await pool.query(query);
  return rows;
};

// [BARU] Cek Stok Batch
const checkStock = async (gudang, items) => {
  const itemList = Array.isArray(items) ? items : [items];
  if (itemList.length === 0) return [];

  const results = [];
  for (const item of itemList) {
    const query = `
  SELECT 
    b.brgd_kode AS kode,
    b.brgd_ukuran AS ukuran,
    (
      b.brgd_jumlah +
      IFNULL((
          SELECT SUM(m.mst_stok_in - m.mst_stok_out) 
          FROM tmasterstok m 
          WHERE m.mst_aktif = "Y" 
            AND m.mst_cab = ?
            AND m.mst_brg_kode = b.brgd_kode 
            AND m.mst_ukuran = b.brgd_ukuran
      ), 0)
    ) AS stok
  FROM tbarangdc_dtl b
  WHERE b.brgd_kode = ? AND b.brgd_ukuran = ?
`;
    const [rows] = await pool.query(query, [gudang, item.kode, item.ukuran]);
    if (rows.length > 0) {
      results.push({
        kode: rows[0].kode,
        ukuran: rows[0].ukuran,
        stok: Number(rows[0].stok),
      });
    } else {
      results.push({ kode: item.kode, ukuran: item.ukuran, stok: 0 });
    }
  }
  return results;
};

module.exports = {
  savePesanan,
  getSourceGudangList,
  checkStock,
};
