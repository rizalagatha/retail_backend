const pool = require("../config/database");

const getList = async (filters) => {
  const { tahun, bulan } = filters;

  const query = `
        WITH 
        -- [BASE 1] Penjualan Bersih (Sama seperti v_nominal di Delphi)
        -- Logika: Sales Kotor - Diskon Faktur - Biaya MP - PPN - Retur
        InvoiceNetto AS (
    SELECT 
        cabang,
        tahun,
        bulan,
        SUM(qty_inv) as qty,
        SUM(netto_inv) as nominal_sales
    FROM (
        SELECT 
            LEFT(h.inv_nomor, 3) AS cabang,
            YEAR(h.inv_tanggal) AS tahun,
            MONTH(h.inv_tanggal) AS bulan,
            h.inv_nomor,
            SUM(d.invd_jumlah) AS qty_inv,
            -- Hitung Netto per 1 nomor invoice secara utuh
            (
                SUM((d.invd_harga - d.invd_diskon) * d.invd_jumlah) 
                - COALESCE(h.inv_disc, 0)
                - COALESCE(h.inv_mp_biaya_platform, 0)
            ) AS netto_inv
        FROM tinv_hdr h
        JOIN tinv_dtl d ON h.inv_nomor = d.invd_inv_nomor
        WHERE h.inv_sts_pro = 0
        GROUP BY h.inv_nomor -- Group by invoice dulu agar h.inv_disc terpotong semua
    ) AS PerInvoice
    GROUP BY cabang, tahun, bulan
),
        ReturNetto AS (
            SELECT 
                LEFT(rh.rj_nomor, 3) AS cabang,
                YEAR(rh.rj_tanggal) AS tahun,
                MONTH(rh.rj_tanggal) AS bulan,
                0 AS qty,
                -SUM(rd.rjd_jumlah * (rd.rjd_harga - rd.rjd_diskon)) AS nominal_retur
            FROM trj_hdr rh
            JOIN trj_dtl rd ON rh.rj_nomor = rd.rjd_nomor
            GROUP BY LEFT(rh.rj_nomor, 3), YEAR(rh.rj_tanggal), MONTH(rh.rj_tanggal)
        ),
        -- v_nominal (Gabungan Sales & Retur)
        V_Nominal AS (
            SELECT cabang, tahun, bulan, SUM(qty) as jumlah, SUM(nominal_sales) as nominal FROM InvoiceNetto GROUP BY cabang, tahun, bulan
            UNION ALL
            SELECT cabang, tahun, bulan, SUM(qty) as jumlah, SUM(nominal_retur) as nominal FROM ReturNetto GROUP BY cabang, tahun, bulan
        ),
        -- Aggregated V_Nominal (karena UNION ALL bisa duplikat row per cabang/bulan)
        V_Nominal_Agg AS (
            SELECT cabang, tahun, bulan, SUM(jumlah) as jumlah, SUM(nominal) as nominal
            FROM V_Nominal
            GROUP BY cabang, tahun, bulan
        ),

        -- [BASE 2] Target Omset (kpi.ttarget_kaosan)
        TargetData AS (
            SELECT kode_gudang AS cabang, tahun, bulan, SUM(target_omset) AS target
            FROM kpi.ttarget_kaosan
            GROUP BY kode_gudang, tahun, bulan
        ),

        -- =========================================================
        -- MAPPING LOGIKA DELPHI (A, B, C, D, E, F, G)
        -- =========================================================

        -- A: Bulan Ini (Actual)
        Data_A AS (
            SELECT cabang, jumlah, nominal FROM V_Nominal_Agg WHERE tahun = ? AND bulan = ?
        ),
        -- B: Target Bulan Ini
        Data_B AS (
            SELECT cabang, target FROM TargetData WHERE tahun = ? AND bulan = ?
        ),
        -- C: Bulan Lalu (Actual)
        Data_C AS (
            SELECT cabang, jumlah, nominal FROM V_Nominal_Agg 
            WHERE (tahun = ? AND bulan = ? - 1) OR (tahun = ? - 1 AND bulan = 12 AND ? = 1)
        ),
        -- D: Kumulatif s.d Bulan Ini (Actual)
        Data_D AS (
            SELECT cabang, SUM(nominal) as nominal 
            FROM V_Nominal_Agg WHERE tahun = ? AND bulan <= ? 
            GROUP BY cabang
        ),
        -- E: Target Kumulatif s.d Bulan Ini
        Data_E AS (
            SELECT cabang, SUM(target) as target 
            FROM TargetData WHERE tahun = ? AND bulan <= ? 
            GROUP BY cabang
        ),
        -- F: Bulan Ini Tahun Lalu (Actual)
        Data_F AS (
            SELECT cabang, nominal FROM V_Nominal_Agg WHERE tahun = ? - 1 AND bulan = ?
        ),
        -- G: Target Akhir Tahun (Full Year Target)
        Data_G AS (
            SELECT cabang, SUM(target) as target 
            FROM TargetData WHERE tahun = ? 
            GROUP BY cabang
        ),

        -- List Semua Cabang
        AllBranches AS (
            SELECT gdg_kode AS cabang, gdg_nama FROM tgudang
            -- Opsional: Filter cabang aktif saja atau yang ada transaksi
        )

        -- SELECT FINAL (Sesuai output Delphi)
        SELECT 
            ? AS tahun,
            ? AS bulan,
            ab.cabang AS kode_cabang,
            ab.gdg_nama AS nama_cabang,

            -- A & B (Bulan Ini)
            IFNULL(a.jumlah, 0) AS qty_bulan_ini,
            IFNULL(a.nominal, 0) AS nominal_bulan_ini,
            IFNULL(b.target, 0) AS target_bulan_ini,
            
            -- C (Bulan Lalu)
            IFNULL(c.jumlah, 0) AS qty_bulan_lalu,
            IFNULL(c.nominal, 0) AS nominal_bulan_lalu,

            -- D & E (Kumulatif)
            IFNULL(d.nominal, 0) AS realisasi_kumulatif,
            IFNULL(e.target, 0) AS target_kumulatif,

            -- F (Tahun Lalu)
            IFNULL(f.nominal, 0) AS realisasi_bulan_ini_thn_lalu,

            -- G (Akhir Tahun)
            IFNULL(g.target, 0) AS target_akhir_tahun,
            0 AS realisasi_akhir_tahun -- Placeholder (Delphi logic: nominal4 (d) / target4 (g))

        FROM AllBranches ab
        LEFT JOIN Data_A a ON ab.cabang = a.cabang
        LEFT JOIN Data_B b ON ab.cabang = b.cabang
        LEFT JOIN Data_C c ON ab.cabang = c.cabang
        LEFT JOIN Data_D d ON ab.cabang = d.cabang
        LEFT JOIN Data_E e ON ab.cabang = e.cabang
        LEFT JOIN Data_F f ON ab.cabang = f.cabang
        LEFT JOIN Data_G g ON ab.cabang = g.cabang
        
        -- Filter agar hanya muncul cabang yang punya data (Sesuai WHERE di Delphi)
        WHERE (
            IFNULL(a.nominal, 0) > 0 OR 
            IFNULL(b.target, 0) > 0 OR 
            IFNULL(c.nominal, 0) > 0 OR 
            IFNULL(d.nominal, 0) > 0
        )
        ORDER BY ab.cabang;
    `;

  const params = [
    // Params A (Bulan Ini)
    tahun,
    bulan,
    // Params B (Target Bulan Ini)
    tahun,
    bulan,
    // Params C (Bulan Lalu - Handle Januari)
    tahun,
    bulan,
    tahun,
    bulan,
    // Params D (Kumulatif Actual)
    tahun,
    bulan,
    // Params E (Kumulatif Target)
    tahun,
    bulan,
    // Params F (Tahun Lalu)
    tahun,
    bulan,
    // Params G (Target Akhir Tahun)
    tahun,

    // Select Constants
    tahun,
    bulan,
  ];

  const [rows] = await pool.query(query, params);
  return rows;
};

const getDynamicCabangOptions = async (filters, user) => {
  const { startDate, endDate } = filters;
  let query = `
        SELECT DISTINCT 
            h.inv_cab AS kode, 
            g.gdg_nama AS nama 
        FROM tinv_hdr h
        JOIN tgudang g ON h.inv_cab = g.gdg_kode
        WHERE h.inv_tanggal BETWEEN ? AND ?
    `;
  const params = [startDate, endDate];

  // Jika user bukan KDC, batasi hanya untuk cabangnya sendiri
  if (user.cabang !== "KDC") {
    query += " AND h.inv_cab = ?";
    params.push(user.cabang);
  }

  query += " ORDER BY kode";
  const [rows] = await pool.query(query, params);

  // Tambahkan opsi "ALL" jika user adalah KDC
  if (user.cabang === "KDC") {
    return [{ kode: "ALL", nama: "Semua Cabang" }, ...rows];
  }
  return rows;
};

module.exports = {
  getList,
  getDynamicCabangOptions,
};
