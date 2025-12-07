const pool = require("../config/database");
const { format, subMonths } = require("date-fns");

const getRealTimeStock = async (filters) => {
  const { gudang, kodeBarang, jenisStok, tampilkanKosong, tanggal } = filters;
  const connection = await pool.getConnection();

  try {
    // Logika Delphi sangat kompleks karena keterbatasan, di Node.js kita bisa lebih efisien.
    // Pendekatan ini menggunakan satu query utama dengan subquery dan pivot dinamis.

    let stockSourceTable = "";
    if (jenisStok === "showroom") {
      stockSourceTable = "tmasterstok";
    } else if (jenisStok === "pesanan") {
      stockSourceTable = "tmasterstokso";
    } else {
      // Semua
      stockSourceTable = `(
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif 
        FROM tmasterstok
        UNION ALL
        SELECT mst_brg_kode, mst_ukuran, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif 
        FROM tmasterstokso
    )`;
    }

    let params = [tanggal, gudang];
    let gudangFilter = `m.mst_cab = ?`;
    if (gudang === "ALL") {
      // Untuk 'ALL', kita tidak filter berdasarkan cabang di subquery stok
      gudangFilter = "1 = 1";
      params = [tanggal];
    }

    let kodeBarangFilter = "";
    if (kodeBarang) {
      kodeBarangFilter = "AND a.brg_kode = ?";
      params.push(kodeBarang);
    }

    const havingClause = !tampilkanKosong ? "HAVING TOTAL > 0" : "";

    const query = `
            SELECT
                a.brg_kode AS KODE,
                a.brg_ktgp AS KTGPRODUK,
                a.brg_ktg AS KTGBARANG,
                TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA,
                SUM(CASE WHEN s.mst_ukuran = 'S' THEN s.stok ELSE 0 END) AS S,
                SUM(CASE WHEN s.mst_ukuran = 'M' THEN s.stok ELSE 0 END) AS M,
                SUM(CASE WHEN s.mst_ukuran = 'L' THEN s.stok ELSE 0 END) AS L,
                SUM(CASE WHEN s.mst_ukuran = 'XL' THEN s.stok ELSE 0 END) AS XL,
                SUM(CASE WHEN s.mst_ukuran = '2XL' THEN s.stok ELSE 0 END) AS \`2XL\`,
                SUM(CASE WHEN s.mst_ukuran = '3XL' THEN s.stok ELSE 0 END) AS \`3XL\`,
                SUM(CASE WHEN s.mst_ukuran = '4XL' THEN s.stok ELSE 0 END) AS \`4XL\`,
                SUM(CASE WHEN s.mst_ukuran = '5XL' THEN s.stok ELSE 0 END) AS \`5XL\`,
                SUM(s.stok) AS TOTAL,
                IFNULL((SELECT SUM(brgd_min) FROM tbarangdc_dtl b WHERE b.brgd_kode = a.brg_kode), 0) AS Buffer
            FROM tbarangdc a
            LEFT JOIN (
                SELECT 
                    m.mst_brg_kode, 
                    m.mst_ukuran, 
                    SUM(m.mst_stok_in - m.mst_stok_out) as stok
                FROM ${stockSourceTable} m
                WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? AND ${gudangFilter}
                GROUP BY m.mst_brg_kode, m.mst_ukuran
            ) s ON a.brg_kode = s.mst_brg_kode
            WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y' ${kodeBarangFilter}
            GROUP BY a.brg_kode, NAMA
            ${havingClause}
            ORDER BY NAMA;
        `;

    const [rows] = await connection.query(query, params);
    return rows;
  } finally {
    connection.release();
  }
};

const getGudangOptions = async (user) => {
  let query = "";
  if (user.cabang === "KDC") {
    query = `
            SELECT 'ALL' AS kode, 'SEMUA' AS nama
            UNION ALL
            SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang ORDER BY kode;
        `;
  } else {
    query =
      'SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang WHERE gdg_kode="KDC" OR gdg_kode = ?';
  }
  const [rows] = await pool.query(query, [user.cabang]);
  return rows;
};

const getLowStock = async (filters) => {
  const { gudang } = filters;
  const connection = await pool.getConnection();

  try {
    // Hitung tanggal 3 bulan ke belakang
    const threeMonthsAgo = format(subMonths(new Date(), 3), "yyyy-MM-dd");
    const today = format(new Date(), "yyyy-MM-dd");

    // Params urutan:
    // 1. Tanggal Stok (Today)
    // 2. Cabang Stok
    // 3. Tanggal Awal Sales (3 Bulan lalu)
    // 4. Cabang Sales (Untuk filter penjualan cabang tsb)
    let params = [today, gudang, threeMonthsAgo];

    let gudangFilter = `m.mst_cab = ?`;
    let salesBranchFilter = `AND LEFT(h.inv_nomor, 3) = ?`;

    // Jika KDC (Pusat), biasanya tidak ada filter penjualan per cabang (Global)
    // Tapi jika dashboard KDC ingin melihat low stock GUDANG KDC, sesuaikan logika ini.
    // Asumsi: Ini dashboard Store/Cabang.
    if (gudang === "KDC") {
      // Jika KDC ingin lihat global, sesuaikan filternya
      // Disini saya biarkan KDC melihat stok dia sendiri
      params.push(gudang);
    } else {
      params.push(gudang);
    }

    const query = `
            SELECT
                a.brg_kode AS KODE,
                (SELECT brgd_barcode FROM tbarangdc_dtl WHERE brgd_kode = a.brg_kode LIMIT 1) AS BARCODE,
                TRIM(CONCAT_WS(' ', a.brg_jeniskaos, a.brg_tipe, a.brg_lengan, a.brg_jeniskain, a.brg_warna)) AS NAMA,
                
                -- Stok Saat Ini
                IFNULL(SUM(s.stok), 0) AS TOTAL,
                
                -- Hitung Rata-rata Penjualan 3 Bulan (Total Qty / 3)
                IFNULL(sales.total_qty, 0) / 3 AS AVG_SALE

            FROM tbarangdc a
            
            -- 1. JOIN KE STOK (Sama seperti sebelumnya)
            LEFT JOIN (
                SELECT 
                    m.mst_brg_kode, 
                    SUM(m.mst_stok_in - m.mst_stok_out) as stok
                FROM (
                    SELECT mst_brg_kode, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstok
                    UNION ALL
                    SELECT mst_brg_kode, mst_stok_in, mst_stok_out, mst_cab, mst_tanggal, mst_aktif FROM tmasterstokso
                ) m
                WHERE m.mst_aktif = 'Y' AND m.mst_tanggal <= ? AND ${gudangFilter}
                GROUP BY m.mst_brg_kode
            ) s ON a.brg_kode = s.mst_brg_kode

            -- 2. JOIN KE PENJUALAN (3 Bulan Terakhir)
            LEFT JOIN (
                SELECT 
                    d.invd_kode,
                    SUM(d.invd_jumlah) as total_qty
                FROM tinv_hdr h
                JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
                WHERE h.inv_sts_pro = 0 
                  AND h.inv_tanggal >= ? -- Filter Tanggal 3 Bulan Lalu
                  ${salesBranchFilter}   -- Filter Cabang
                GROUP BY d.invd_kode
            ) sales ON a.brg_kode = sales.invd_kode

            WHERE a.brg_aktif = 0 AND a.brg_logstok = 'Y'
            GROUP BY a.brg_kode, NAMA
            
            -- KONDISI: Stok Habis (<=0) DAN Punya Penjualan (>0)
            -- Jadi barang mati (tidak laku) tidak akan muncul meskipun stok 0
            HAVING TOTAL <= 0 AND AVG_SALE > 0
            
            -- URUTKAN: Prioritas barang yang paling laku (Fast Moving)
            ORDER BY AVG_SALE DESC
            LIMIT 20;
        `;

    const [rows] = await connection.query(query, params);
    return rows;
  } finally {
    connection.release();
  }
};

module.exports = {
  getRealTimeStock,
  getGudangOptions,
  getLowStock,
};
