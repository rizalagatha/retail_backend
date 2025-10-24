const pool = require("../config/database");
const { format, startOfMonth, endOfMonth } = require("date-fns");

/**
 * Mengambil data Laporan Stok Stagnan.
 * Query ini adalah optimasi besar dari alur 'btnRefreshClick' di Delphi,
 * menggantikan tabel temporer dan looping dengan satu query CTE.
 */
const getList = async (filters, user) => {
  const { tahun, bulan } = filters;

  const tglAwalBulan = format(new Date(tahun, bulan - 1, 1), "yyyy-MM-dd");
  const tglAkhirBulan = format(
    endOfMonth(new Date(tahun, bulan - 1, 1)),
    "yyyy-MM-dd"
  );

  const query = `
        WITH
        GudangStore AS (
            SELECT gdg_kode, gdg_nama, gdg_lastSopOld, gdg_last_sop
            FROM tgudang 
            WHERE gdg_dc = 0
        ),
        -- 1. Hitung Stok Awal untuk SEMUA gudang dalam satu CTE
        StokAwalData AS (
            SELECT
                LEFT(m.mst_noreferensi, 3) AS cabang,
                m.mst_brg_kode,
                m.mst_ukuran,
                IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS awal
            FROM tmasterstok m
            JOIN GudangStore g ON LEFT(m.mst_noreferensi, 3) = g.gdg_kode
            WHERE m.mst_tanggal >= IF(
                    ? <= g.gdg_lastSopOld, 
                    g.gdg_lastSopOld + INTERVAL 1 DAY, 
                    IF(? > g.gdg_last_sop, g.gdg_last_sop, g.gdg_lastSopOld)
                  )
              AND m.mst_tanggal < ?
            GROUP BY 1, 2, 3
        ),
        -- 2. Agregasi Stok Awal per cabang
        StokAwal AS (
            SELECT 
                d.cabang,
                SUM(d.awal) AS StokAwal,
                SUM(d.awal * IFNULL(b.brgd_hpp, 0)) AS RpAwal
            FROM StokAwalData d
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mst_brg_kode AND b.brgd_ukuran = d.mst_ukuran
            GROUP BY d.cabang
        ),
        -- 3. Hitung Penjualan (Invoice) di bulan terpilih
        Penjualan AS (
            SELECT 
                LEFT(h.inv_nomor, 3) AS cabang,
                SUM(d.invd_jumlah) AS QtyInv,
                SUM(
                    (d.invd_jumlah * (d.invd_harga - d.invd_diskon)) 
                    - (h.inv_disc / (SELECT COUNT(*) FROM tinv_dtl i WHERE i.invd_inv_nomor = h.inv_nomor))
                ) AS RpInvoice
            FROM tinv_hdr h
            JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
            WHERE h.inv_sts_pro = 0 AND h.inv_tanggal BETWEEN ? AND ?
            GROUP BY LEFT(h.inv_nomor, 3)
        ),
        -- 4. Hitung Stok Akhir (stok real time saat ini)
        StokAkhir AS (
            SELECT 
                LEFT(m.mst_noreferensi, 3) AS cabang,
                SUM(m.mst_stok_in - m.mst_stok_out) AS StokAkhir,
                SUM((m.mst_stok_in - m.mst_stok_out) * IFNULL(b.brgd_hpp, 0)) AS RpAkhir
            FROM tmasterstok m
            LEFT JOIN tbarangdc_dtl b ON m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = m.mst_ukuran
            WHERE m.mst_aktif = 'Y' AND LEFT(m.mst_noreferensi, 3) IN (SELECT gdg_kode FROM GudangStore)
            GROUP BY 1
        )
        -- 5. Gabungkan semua data
        SELECT 
            g.gdg_nama AS Cabang,
            IFNULL(sa.StokAwal, 0) AS StokAwal,
            IFNULL(sa.RpAwal, 0) AS RpAwal,
            IFNULL(p.QtyInv, 0) AS QtyInv,
            IFNULL(p.RpInvoice, 0) AS RpInvoice,
            IFNULL(sk.StokAkhir, 0) AS StokAkhir,
            IFNULL(sk.RpAkhir, 0) AS RpAkhir
        FROM GudangStore g
        LEFT JOIN StokAwal sa ON g.gdg_kode = sa.cabang
        LEFT JOIN Penjualan p ON g.gdg_kode = p.cabang
        LEFT JOIN StokAkhir sk ON g.gdg_kode = sk.cabang
        WHERE IFNULL(sa.StokAwal, 0) <> 0 
           OR IFNULL(p.QtyInv, 0) <> 0 
           OR IFNULL(sk.StokAkhir, 0) <> 0;
    `;

  // Parameter untuk query (StokAwalData (3), Penjualan (2))
  const params = [
    tglAwalBulan,
    tglAwalBulan,
    tglAwalBulan,
    tglAwalBulan,
    tglAkhirBulan,
  ];

  const [rows] = await pool.query(query, params);
  return rows;
};

// Ganti juga getExportDetails
const getExportDetails = async (filters, user) => {
  const { tahun, bulan } = filters;

  const tglAwalBulan = format(new Date(tahun, bulan - 1, 1), "yyyy-MM-dd");
  const tglAkhirBulan = format(
    endOfMonth(new Date(tahun, bulan - 1, 1)),
    "yyyy-MM-dd"
  );

  const query = `
        WITH
        GudangStore AS (
            SELECT gdg_kode, gdg_nama, gdg_lastSopOld, gdg_last_sop
            FROM tgudang 
            WHERE gdg_dc = 0
        ),
        StokAwalData AS (
            SELECT
                LEFT(m.mst_noreferensi, 3) AS cabang,
                m.mst_brg_kode,
                m.mst_ukuran,
                IFNULL(SUM(m.mst_stok_in - m.mst_stok_out), 0) AS awal
            FROM tmasterstok m
            JOIN GudangStore g ON LEFT(m.mst_noreferensi, 3) = g.gdg_kode
            WHERE m.mst_tanggal >= IF(
                    ? <= g.gdg_lastSopOld, 
                    g.gdg_lastSopOld + INTERVAL 1 DAY, 
                    IF(? > g.gdg_last_sop, g.gdg_last_sop, g.gdg_lastSopOld)
                  )
              AND m.mst_tanggal < ?
            GROUP BY 1, 2, 3
        ),
        StokAwal AS (
            SELECT 
                d.cabang, d.mst_brg_kode AS kode, d.mst_ukuran AS ukuran,
                SUM(d.awal) AS StokAwal,
                SUM(d.awal * IFNULL(b.brgd_hpp, 0)) AS RpAwal
            FROM StokAwalData d
            LEFT JOIN tbarangdc_dtl b ON b.brgd_kode = d.mst_brg_kode AND b.brgd_ukuran = d.mst_ukuran
            GROUP BY d.cabang, d.mst_brg_kode, d.mst_ukuran
        ),
        Penjualan AS (
            SELECT 
                LEFT(h.inv_nomor, 3) AS cabang,
                d.invd_kode AS kode,
                d.invd_ukuran AS ukuran,
                SUM(d.invd_jumlah) AS QtyInv,
                SUM(
                    (d.invd_jumlah * (d.invd_harga - d.invd_diskon)) 
                    - (h.inv_disc / (SELECT COUNT(*) FROM tinv_dtl i WHERE i.invd_inv_nomor = h.inv_nomor))
                ) AS RpInvoice
            FROM tinv_hdr h
            JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
            WHERE h.inv_sts_pro = 0 AND h.inv_tanggal BETWEEN ? AND ?
            GROUP BY 1, 2, 3
        ),
        StokAkhir AS (
            SELECT 
                LEFT(m.mst_noreferensi, 3) AS cabang,
                m.mst_brg_kode AS kode,
                m.mst_ukuran AS ukuran,
                SUM(m.mst_stok_in - m.mst_stok_out) AS StokAkhir,
                SUM((m.mst_stok_in - m.mst_stok_out) * IFNULL(b.brgd_hpp, 0)) AS RpAkhir
            FROM tmasterstok m
            LEFT JOIN tbarangdc_dtl b ON m.mst_brg_kode = b.brgd_kode AND m.mst_ukuran = m.mst_ukuran
            WHERE m.mst_aktif = 'Y' AND LEFT(m.mst_noreferensi, 3) IN (SELECT gdg_kode FROM GudangStore)
            GROUP BY 1, 2, 3
        ),
        AllItems AS (
            SELECT cabang, kode, ukuran FROM StokAwal
            UNION
            SELECT cabang, kode, ukuran FROM Penjualan
            UNION
            SELECT cabang, kode, ukuran FROM StokAkhir
        )
        SELECT 
            ai.cabang,
            g.gdg_nama AS 'Nama Cabang',
            ai.kode AS 'Kode Barang',
            TRIM(CONCAT(a.brg_jeniskaos," ",a.brg_tipe," ",a.brg_lengan," ",a.brg_jeniskain," ",a.brg_warna)) AS 'Nama Barang',
            ai.ukuran AS 'Ukuran',
            IFNULL(sa.StokAwal, 0) AS 'Qty Stok Awal',
            IFNULL(sa.RpAwal, 0) AS 'Value Stok Awal',
            IFNULL(p.QtyInv, 0) AS 'Qty Terjual',
            IFNULL(p.RpInvoice, 0) AS 'Value Terjual',
            IFNULL(sk.StokAkhir, 0) AS 'Qty Stok Akhir',
            IFNULL(sk.RpAkhir, 0) AS 'Value Stok Akhir'
        FROM AllItems ai
        JOIN tbarangdc a ON ai.kode = a.brg_kode
        JOIN GudangStore g ON ai.cabang = g.gdg_kode
        LEFT JOIN StokAwal sa ON ai.cabang = sa.cabang AND ai.kode = sa.kode AND ai.ukuran = sa.ukuran
        LEFT JOIN Penjualan p ON ai.cabang = p.cabang AND ai.kode = p.kode AND ai.ukuran = p.ukuran
        LEFT JOIN StokAkhir sk ON ai.cabang = sk.cabang AND ai.kode = sk.kode AND ai.ukuran = sk.ukuran
        WHERE IFNULL(sa.StokAwal, 0) <> 0 
           OR IFNULL(p.QtyInv, 0) <> 0 
           OR IFNULL(sk.StokAkhir, 0) <> 0
        ORDER BY ai.cabang, 'Nama Barang', ai.ukuran;
    `;

  const params = [
    tglAwalBulan,
    tglAwalBulan,
    tglAwalBulan,
    tglAwalBulan,
    tglAkhirBulan,
  ];
  const [rows] = await pool.query(query, params);
  return rows;
};

module.exports = {
  getList,
  getExportDetails,
};
