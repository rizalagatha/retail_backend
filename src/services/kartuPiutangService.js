const pool = require("../config/database");

const getCustomerReceivables = async (filters, user) => {
  const { cabang, customerKode } = filters;

  // Query ini adalah optimasi dari query SQLMaster di Delphi
  const query = `
        SELECT 
            c.cus_kode AS kode,
            c.cus_nama AS nama,
            c.cus_alamat AS alamat,
            c.cus_kota AS kota,
            IF(c.cus_aktif = 0, 'Aktif', 'Pasif') AS status,
            IFNULL(SUM(ph.ph_nominal), 0) AS nominalNota,
            IFNULL(pd.total_kredit, 0) AS terbayar,
            IFNULL(pd.total_debet - pd.total_kredit, 0) AS sisaPiutang
        FROM tcustomer c
        LEFT JOIN tpiutang_hdr ph ON c.cus_kode = ph.ph_cus_kode 
            ${cabang !== "ALL" ? "AND LEFT(ph.ph_inv_nomor, 3) = ?" : ""}
        LEFT JOIN (
            SELECT 
                LEFT(pd_ph_nomor, LENGTH(pd_ph_nomor) - 17) AS cus_kode,
                ${
                  cabang !== "ALL"
                    ? "RIGHT(LEFT(pd_ph_nomor, LENGTH(pd_ph_nomor) - 14), 3) AS cabang,"
                    : ""
                }
                SUM(pd_debet) AS total_debet,
                SUM(pd_kredit) AS total_kredit
            FROM tpiutang_dtl
            GROUP BY cus_kode ${cabang !== "ALL" ? ", cabang" : ""}
        ) pd ON c.cus_kode = pd.cus_kode ${
          cabang !== "ALL" ? "AND pd.cabang = ?" : ""
        }
        ${customerKode ? "WHERE c.cus_kode = ?" : ""}
        GROUP BY c.cus_kode
        ORDER BY c.cus_nama;
    `;

  let params = [];
  if (cabang !== "ALL") {
    params.push(cabang, cabang);
  }
  if (customerKode) {
    params.push(customerKode);
  }

  const [rows] = await pool.query(query, params);
  return rows;
};

const getCabangOptions = async (user) => {
  // Logika dari Delphi: KDC bisa lihat 'ALL', cabang lain hanya diri sendiri
  let query = "SELECT gdg_kode AS kode, gdg_nama AS nama FROM tgudang";
  if (user.cabang !== "KDC") {
    query += " WHERE gdg_kode = ?";
  }
  const [rows] = await pool.query(
    query,
    user.cabang !== "KDC" ? [user.cabang] : []
  );

  if (user.cabang === "KDC") {
    rows.unshift({ kode: "ALL", nama: "Semua Cabang" });
  }
  return rows;
};

const getInvoiceList = async (customerKode, cabang) => {
    let query = `
        SELECT 
            h.ph_nomor AS nomor,
            h.ph_tanggal AS tanggal,
            h.ph_inv_nomor AS invoice,
            h.ph_top AS top,
            DATE_ADD(h.ph_tanggal, INTERVAL h.ph_top DAY) as jatuhTempo,
            h.ph_nominal AS nominal,
            IFNULL((SELECT SUM(pd_kredit) FROM tpiutang_dtl WHERE pd_ph_nomor = h.ph_nomor), 0) AS terbayar,
            IFNULL((SELECT SUM(pd_debet - pd_kredit) FROM tpiutang_dtl WHERE pd_ph_nomor = h.ph_nomor), 0) AS sisa
        FROM tpiutang_hdr h 
        WHERE h.ph_cus_kode = ?
    `;
    const params = [customerKode];

    if (cabang !== 'ALL') {
        query += ' AND LEFT(h.ph_inv_nomor, 3) = ?';
        params.push(cabang);
    }
    query += ' ORDER BY h.ph_tanggal DESC, h.ph_inv_nomor';
    
    const [rows] = await pool.query(query, params);
    return rows;
};

// Meniru 'loadpd' untuk mendapatkan detail pembayaran per invoice
const getPaymentDetails = async (piutangHeaderNomor) => {
    const query = `
        SELECT 
            pd_tanggal AS tanggal,
            pd_uraian AS uraian,
            pd_debet AS debet,
            pd_kredit AS kredit,
            pd_ket AS keterangan
        FROM tpiutang_dtl 
        WHERE pd_ph_nomor = ? 
        ORDER BY pd_tanggal;
    `;
    const [rows] = await pool.query(query, [piutangHeaderNomor]);
    return rows;
};

module.exports = { getCustomerReceivables, getCabangOptions, getInvoiceList, getPaymentDetails, };
