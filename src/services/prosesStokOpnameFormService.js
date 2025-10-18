const pool = require("../config/database");
const { format } = require("date-fns");

// Fungsi untuk membuat nomor SOP baru
const generateNewNumber = async (connection, branchCode, date) => {
  const prefix = `${branchCode}.SOP.${format(new Date(date), "yyMM")}`;
  const query = `SELECT IFNULL(MAX(RIGHT(sop_nomor, 4)), 0) as max_nomor FROM tsop_hdr WHERE LEFT(sop_nomor, 12) = ?`;
  const [rows] = await connection.query(query, [prefix]);
  const nextNumber = parseInt(rows[0].max_nomor, 10) + 1;
  return `${prefix}.${String(nextNumber).padStart(4, "0")}`;
};

/**
 * Mengambil data selisih dari hasil hitung stok untuk di-load ke form.
 */
const getInitialData = async (user) => {
  const { cabang } = user;

  // 1. Dapatkan tanggal stok opname yang aktif
  const [sopTanggalRows] = await pool.query(
    "SELECT st_tanggal FROM tsop_tanggal WHERE st_cab = ? AND st_transfer = 'N' LIMIT 1",
    [cabang]
  );
  if (sopTanggalRows.length === 0) {
    throw new Error(
      `Tidak ada tanggal stok opname yang aktif untuk cabang ${cabang}.`
    );
  }
  const zsoptgl = sopTanggalRows[0].st_tanggal;

  // 2. Query dari 'btnHitungClick' Delphi untuk mengambil data selisih
  const query = `
        SELECT y.Kode, y.Barcode, y.Nama, y.Ukuran, y.hpp, y.lokasi,
               (y.showroom + y.pesan) AS Stok, y.hitung AS Jumlah, y.Selisih
        FROM (
            SELECT x.*, (x.hitung - (x.showroom + x.pesan)) AS Selisih
            FROM (
                SELECT 
                    a.brg_kode AS Kode, b.brgd_barcode AS Barcode, 
                    TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS Nama,
                    b.brgd_ukuran AS Ukuran, IF(b.brgd_hpp=0, 1, b.brgd_hpp) AS hpp,
                    IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_tanggal < ? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran), 0) AS showroom,
                    IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_tanggal < ? AND m.mst_brg_kode=b.brgd_kode AND m.mst_ukuran=b.brgd_ukuran), 0) AS pesan,
                    IFNULL((SELECT SUM(u.hs_qty) FROM thitungstok u WHERE u.hs_proses="N" AND u.hs_cab=? AND u.hs_kode=b.brgd_kode AND u.hs_ukuran=b.brgd_ukuran), 0) AS hitung,
                    IFNULL((SELECT CAST(GROUP_CONCAT(CONCAT(h.hs_lokasi,"=",h.hs_qty) SEPARATOR ", ") AS CHAR) FROM thitungstok h WHERE h.hs_proses="N" AND h.hs_cab=? AND h.hs_kode=b.brgd_kode AND h.hs_ukuran=b.brgd_ukuran), "") AS lokasi
                FROM tbarangdc_dtl b
                JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
                WHERE a.brg_logstok="Y"
            ) x
            WHERE (x.showroom + x.pesan) <> 0 OR x.hitung <> 0
        ) y
        WHERE y.Selisih <> 0
        ORDER BY y.Nama, RIGHT(y.barcode, 2)
    `;

  const params = [cabang, zsoptgl, cabang, zsoptgl, cabang, cabang];
  const [items] = await pool.query(query, params);

  return { tanggal: zsoptgl, items };
};

/**
 * Menyimpan data Stok Opname (header & detail).
 */
const saveData = async (payload, user) => {
  const { header, items } = payload;
  const isEdit = !!header.nomor && header.nomor !== "<-- Kosong=Baru"; // Logika untuk mendeteksi mode edit
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let sopNomor = header.nomor;
    if (!isEdit) {
      // Panggil fungsi generate nomor baru jika mode 'Create'
      sopNomor = await generateNewNumber(
        connection,
        user.cabang,
        header.tanggal
      );
    }

    // Siapkan data untuk tabel header
    const headerData = {
      sop_tanggal: header.tanggal,
      sop_ket: header.keterangan,
    };

    if (isEdit) {
      headerData.user_modified = user.kode;
      headerData.date_modified = new Date();
      await connection.query("UPDATE tsop_hdr SET ? WHERE sop_nomor = ?", [
        headerData,
        sopNomor,
      ]);
    } else {
      headerData.sop_nomor = sopNomor;
      headerData.user_create = user.kode;
      headerData.date_create = new Date();
      await connection.query("INSERT INTO tsop_hdr SET ?", headerData);
    }

    // Hapus detail lama (baik mode edit maupun create, sesuai logika Delphi)
    await connection.query("DELETE FROM tsop_dtl2 WHERE sopd_nomor = ?", [
      sopNomor,
    ]);

    // Insert detail yang baru dari grid
    for (const item of items) {
      // Validasi HPP dari Delphi
      if (item.hpp === 0 || item.hpp === null) {
        throw new Error(
          `HPP untuk barang ${item.Nama} (${item.Ukuran}) harus diisi.`
        );
      }

      const detailData = {
        sopd_nomor: sopNomor,
        sopd_kode: item.Kode,
        sopd_ukuran: item.Ukuran,
        sopd_stok: item.Stok,
        sopd_jumlah: item.Jumlah,
        sopd_selisih: item.Selisih,
        sopd_hpp: item.hpp,
        sopd_ket: item.Lokasi,
      };
      await connection.query("INSERT INTO tsop_dtl2 SET ?", detailData);
    }

    await connection.commit();
    return {
      message: `Stok Opname ${sopNomor} berhasil disimpan.`,
      nomor: sopNomor,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getDataForEdit = async (nomor) => {
  // Query ini adalah terjemahan dari 'loaddataall'
  const query = `
        SELECT 
            h.sop_nomor, h.sop_tanggal, h.sop_ket, g.gdg_nama, d.sopd_kode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS Nama,
            d.sopd_ukuran, d.sopd_stok, d.sopd_jumlah, d.sopd_selisih, d.sopd_hpp, d.sopd_ket,
            (d.sopd_selisih * d.sopd_hpp) AS Nominal, b.brgd_barcode
        FROM tsop_hdr h
        INNER JOIN tsop_dtl2 d ON d.sopd_nomor = h.sop_nomor
        LEFT JOIN tgudang g ON LEFT(h.sop_nomor, 3) = g.gdg_kode
        LEFT JOIN tbarangdc a ON a.brg_kode = d.sopd_kode
        LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.sopd_kode AND b.brgd_ukuran = d.sopd_ukuran
        WHERE h.sop_nomor = ?;
    `;
  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) {
    throw new Error(
      `Dokumen Stok Opname dengan nomor ${nomor} tidak ditemukan.`
    );
  }

  // Proses data menjadi format { header, items }
  const header = {
    nomor: rows[0].sop_nomor,
    tanggal: format(new Date(rows[0].sop_tanggal), "yyyy-MM-dd"),
    keterangan: rows[0].sop_ket,
    gudang: rows[0].sop_nomor.substring(0, 3),
    gudangNama: rows[0].gdg_nama,
  };

  const items = rows.map((row) => ({
    Kode: row.sopd_kode,
    Nama: row.Nama,
    Ukuran: row.sopd_ukuran,
    Stok: row.sopd_stok,
    Jumlah: row.sopd_jumlah,
    Selisih: row.sopd_selisih,
    hpp: row.sopd_hpp,
    Total: row.Nominal,
    Lokasi: row.sopd_ket,
    Barcode: row.brgd_barcode,
  }));

  return { header, items };
};

const getProductDetailsForSop = async (barcode, cabang, tanggalSop) => {
    // 1. Ambil detail produk berdasarkan barcode
    const productQuery = `
        SELECT 
            b.brgd_kode, b.brgd_barcode,
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS nama,
            b.brgd_ukuran, IF(b.brgd_hpp = 0, 1, b.brgd_hpp) AS hpp
        FROM tbarangdc_dtl b
        INNER JOIN tbarangdc a ON a.brg_kode = b.brgd_kode
        WHERE a.brg_aktif = 0 AND b.brgd_barcode = ?
    `;
    const [productRows] = await pool.query(productQuery, [barcode]);
    if (productRows.length === 0) throw new Error('Barcode tidak terdaftar.');
    const product = productRows[0];

    // 2. Hitung stok awal (logika dari getStokawal)
    const stockQuery = `
        SELECT 
            (
                IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_tanggal < ? AND m.mst_brg_kode=? AND m.mst_ukuran=?), 0)
                +
                IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_tanggal < ? AND m.mst_brg_kode=? AND m.mst_ukuran=?), 0)
            ) as stok
    `;
    const stockParams = [
        cabang, tanggalSop, product.brgd_kode, product.brgd_ukuran,
        cabang, tanggalSop, product.brgd_kode, product.brgd_ukuran
    ];
    const [stockRows] = await pool.query(stockQuery, stockParams);
    const stokAwal = stockRows[0].stok;

    // 3. Gabungkan hasilnya
    return {
        Kode: product.brgd_kode,
        Barcode: product.brgd_barcode,
        Nama: product.nama,
        Ukuran: product.brgd_ukuran,
        hpp: product.hpp,
        Stok: stokAwal
    };
};

/**
 * Mengambil dan memproses data dari tabel staging 'tsop_data' (unpivot).
 * Ini adalah migrasi dari prosedur btndataClick.
 */
const getDataFromStaging = async (user) => {
    const { cabang } = user;

    // 1. Dapatkan tanggal stok opname yang aktif
    const [sopTanggalRows] = await pool.query(
        "SELECT st_tanggal FROM tsop_tanggal WHERE st_cab = ? AND st_transfer = 'N' LIMIT 1",
        [cabang]
    );
    if (sopTanggalRows.length === 0) {
        throw new Error(`Tidak ada tanggal stok opname yang aktif untuk cabang ${cabang}.`);
    }
    const zsoptgl = sopTanggalRows[0].st_tanggal;

    // 2. Query utama yang melakukan UNPIVOT dan kalkulasi
    const query = `
        SELECT 
            y.kode AS Kode,
            y.nama AS Nama,
            y.ukuran AS Ukuran,
            y.barcode AS Barcode,
            y.hpp AS hpp,
            y.stok_awal AS Stok,
            y.jumlah AS Jumlah,
            (y.jumlah - y.stok_awal) AS Selisih,
            ((y.jumlah - y.stok_awal) * y.hpp) AS Total,
            '' AS Lokasi -- Kolom lokasi tidak tersedia di tsop_data, diisi string kosong
        FROM (
            SELECT
                unpivoted.kode,
                unpivoted.nama,
                unpivoted.ukuran,
                unpivoted.jumlah,
                IF(dtl.brgd_hpp = 0, 1, dtl.brgd_hpp) AS hpp,
                dtl.brgd_barcode AS barcode,
                (
                    IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstok m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_tanggal < ? AND m.mst_brg_kode=unpivoted.kode AND m.mst_ukuran=unpivoted.ukuran), 0)
                    +
                    IFNULL((SELECT SUM(m.mst_stok_in - m.mst_stok_out) FROM tmasterstokso m WHERE m.mst_aktif="Y" AND m.mst_cab=? AND m.mst_tanggal < ? AND m.mst_brg_kode=unpivoted.kode AND m.mst_ukuran=unpivoted.ukuran), 0)
                ) AS stok_awal
            FROM (
                -- Proses UNPIVOT dari tsop_data
                SELECT kd_kode AS kode, 'ALLSIZE' AS ukuran, allsize AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, 'XS' AS ukuran, xs AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, 'S' AS ukuran, s AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, 'M' AS ukuran, m AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, 'L' AS ukuran, l AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, 'XL' AS ukuran, xl AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, '2XL' AS ukuran, \`2xl\` AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, '3XL' AS ukuran, \`3xl\` AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, '4XL' AS ukuran, \`4xl\` AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, '5XL' AS ukuran, \`5xl\` AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, 'OVERSIZE' AS ukuran, oversize AS jumlah FROM retail.tsop_data UNION ALL
                SELECT kd_kode, 'JUMBO' AS ukuran, jumbo AS jumlah FROM retail.tsop_data
            ) AS unpivoted
            JOIN tbarangdc dc ON dc.brg_kode = unpivoted.kode
            LEFT JOIN tbarangdc_dtl dtl ON dtl.brgd_kode = unpivoted.kode AND dtl.brgd_ukuran = unpivoted.ukuran
            WHERE unpivoted.jumlah > 0 -- Hanya ambil yang ada jumlahnya
        ) y
        -- Filter akhir dari Delphi: tampilkan jika ada selisih atau ada jumlah fisik
        WHERE (y.jumlah - y.stok_awal) <> 0 OR y.jumlah <> 0
    `;

    const params = [cabang, zsoptgl, cabang, zsoptgl];
    const [items] = await pool.query(query, params);

    return { tanggal: zsoptgl, items };
};

module.exports = {
  getInitialData,
  saveData,
  getDataForEdit,
  getProductDetailsForSop,
  getDataFromStaging,
};
