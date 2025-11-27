const pool = require("../config/database");
const { format } = require("date-fns");

const generateNewShNumber = async (cabang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${cabang}.STR.${format(date, "yyMM")}.`;
  const query = `
    SELECT IFNULL(MAX(RIGHT(sh_nomor, 4)), 0) + 1 AS next_num
    FROM tsetor_hdr 
    WHERE sh_nomor LIKE ?;
    `;
  const [rows] = await pool.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");
  return `${prefix}${nextNumber}`;
};

/**
 * Menghitung nilai minimal DP 30% dari total sebuah SO.
 * Diadaptasi dari fungsi getmindp di Delphi.
 */
const calculateMinDp = async (nomorSo) => {
  if (!nomorSo) return 0;

  const query = `
    SELECT 
        ROUND(
            SUM(dd.sod_jumlah * (dd.sod_harga - dd.sod_diskon)) - hh.so_disc + 
            (hh.so_ppn / 100 * (SUM(dd.sod_jumlah * (dd.sod_harga - dd.sod_diskon)) - hh.so_disc)) + 
            hh.so_bkrm
        ) AS nominal
    FROM tso_dtl dd
    LEFT JOIN tso_hdr hh ON hh.so_nomor = dd.sod_so_nomor
    WHERE hh.so_nomor = ?
    GROUP BY hh.so_nomor;
    `;
  const [rows] = await pool.query(query, [nomorSo]);

  if (rows.length > 0 && rows[0].nominal) {
    // Ambil 30% dari total nominal SO
    return 0.3 * rows[0].nominal;
  }
  return 0;
};

const saveData = async (payload, user) => {
  const { header, items, isNew } = payload;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // --- VALIDASI DARI DELPHI ---
    if (!header.customer?.kode && !isNew)
      throw new Error("Customer harus diisi.");
    if (!header.nominal) throw new Error("Nominal setoran harus diisi.");
    if (header.jenisSetor === "TRANSFER" && !header.akun?.kode)
      throw new Error("Akun bank harus diisi.");
    if (header.jenisSetor === "GIRO" && !header.nomorGiro)
      throw new Error("No. Giro harus diisi.");
    if (header.sisa < 0)
      throw new Error("Sisa pembayaran minus. Cek kembali alokasi pembayaran.");
    if (header.nomorSo) {
      const minDp = await calculateMinDp(header.nomorSo);
      if (header.nominal < minDp) {
        const formattedMinDp = new Intl.NumberFormat("id-ID").format(minDp);
        throw new Error(
          `Setoran ini untuk DP SO ${header.nomorSo}. Nominal tidak boleh kurang dari Rp ${formattedMinDp}`
        );
      }
    }
    // --- AKHIR VALIDASI ---

    let shNomor = header.nomor;
    const timestamp = format(new Date(), "yyyyMMddHHmmssSSS");
    const idrec = `${user.cabang}SH${timestamp}`;

    if (isNew) {
      shNomor = await generateNewShNumber(user.cabang, header.tanggal);

      const headerSql = `
        INSERT INTO tsetor_hdr (
          sh_idrec, sh_nomor, sh_cus_kode, sh_tanggal, sh_jenis, sh_nominal,
          sh_akun, sh_norek, sh_tgltransfer, sh_giro, sh_tglgiro, sh_tempogiro,
          sh_ket, user_create, date_create
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW());
      `;

      const jenisMap = { TUNAI: 0, TRANSFER: 1, GIRO: 2 };

      // 1️⃣ INSERT HEADER dulu
      await connection.query(headerSql, [
        idrec,
        shNomor,
        header.customer.kode,
        header.tanggal,
        jenisMap[header.jenisSetor],
        header.nominal,
        header.akun?.kode,
        header.akun?.rekening,
        header.tanggalTransfer,
        header.nomorGiro,
        header.tanggalGiro,
        header.tanggalJatuhTempo,
        header.keterangan,
        user.kode,
      ]);

      // 2️⃣ Setelah insert → jika ini DP SO → simpan nomor SO
      if (header.nomorSo) {
        await connection.query(
          `UPDATE tsetor_hdr SET sh_so_nomor = ? WHERE sh_nomor = ?`,
          [header.nomorSo, shNomor]
        );
      }
    }

    // Hapus detail lama jika mode edit, dan insert ulang
    await connection.query("DELETE FROM tsetor_dtl WHERE sd_sh_nomor = ?", [
      shNomor,
    ]);
    await connection.query("DELETE FROM tpiutang_dtl WHERE pd_ket = ?", [
      shNomor,
    ]);

    const validItems = items.filter(
      (item) => item.invoice && (item.bayar || 0) > 0
    );
    if (validItems.length > 0) {
      const detailSql = `
        INSERT INTO tsetor_dtl (sd_idrec, sd_sh_nomor, sd_tanggal, sd_inv, sd_bayar, sd_ket, sd_angsur, sd_nourut) 
        VALUES ?;
        `;
      const piutangDetailSql = `
        INSERT INTO tpiutang_dtl (pd_ph_nomor, pd_tanggal, pd_uraian, pd_kredit, pd_ket, pd_sd_angsur) 
        VALUES ?;
        `;

      const detailValues = [];
      const piutangValues = [];

      validItems.forEach((item, index) => {
        const angsurId = `${user.cabang}SD${format(
          new Date(),
          "yyyyMMddHHmmssSSS"
        )}${index}`;
        detailValues.push([
          idrec,
          shNomor,
          item.tglBayar,
          item.invoice,
          item.bayar,
          item.keterangan,
          angsurId,
          index + 1,
        ]);

        if (item.invoice.includes("INV")) {
          piutangValues.push([
            `${header.customer.kode}${item.invoice}`,
            item.tglBayar,
            `Pembayaran ${header.jenisSetor}`,
            item.bayar,
            shNomor,
            angsurId,
          ]);
        }
      });

      if (detailValues.length > 0)
        await connection.query(detailSql, [detailValues]);
      if (piutangValues.length > 0)
        await connection.query(piutangDetailSql, [piutangValues]);
    }

    if (header.nomorSo) {
      await activateSoIfDpEnough(connection, header.nomorSo, shNomor, user);
    }

    await connection.commit();
    return { message: `Setoran ${shNomor} berhasil disimpan.`, nomor: shNomor };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const searchUnpaidInvoices = async (
  term,
  page,
  itemsPerPage,
  customerKode,
  user
) => {
  const offset = (page - 1) * itemsPerPage;
  const searchTerm = `%${term || ""}%`;

  const subQuery = `
    SELECT 
        h.ph_inv_nomor AS invoice,
        h.ph_tanggal AS tanggal,
        h.ph_top AS top,
        DATE_ADD(h.ph_tanggal, INTERVAL h.ph_top DAY) as jatuhTempo,
        h.ph_nominal AS nominal,
        IFNULL((SELECT SUM(d.pd_kredit) FROM tpiutang_dtl d WHERE d.pd_ph_nomor = h.ph_nomor), 0) AS terbayar
    FROM tpiutang_hdr h
    WHERE h.ph_cus_kode = ? AND h.ph_cab = ?
    `;
  const baseFrom = `FROM (${subQuery}) AS x`;
  const whereClause = `WHERE (x.nominal - x.terbayar) > 0 AND x.invoice LIKE ?`;

  const countQuery = `SELECT COUNT(*) as total ${baseFrom} ${whereClause}`;
  const [countRows] = await pool.query(countQuery, [
    customerKode,
    user.cabang,
    searchTerm,
  ]);
  const total = countRows[0].total;

  const dataQuery = `
    SELECT x.*, (x.nominal - x.terbayar) as sisa
    ${baseFrom} ${whereClause}
    ORDER BY x.tanggal DESC
    LIMIT ? OFFSET ?;
    `;
  const [items] = await pool.query(dataQuery, [
    customerKode,
    user.cabang,
    searchTerm,
    itemsPerPage,
    offset,
  ]);
  return { items, total };
};

const loadForEdit = async (nomor, user) => {
  // 1. Ambil data header
  const headerQuery = `
    SELECT 
        h.sh_nomor AS nomor,
        h.sh_tanggal AS tanggal,
        h.sh_cus_kode AS customer_kode,
        c.cus_nama AS customer_nama,
        c.cus_alamat AS customer_alamat,
        c.cus_kota AS customer_kota,
        c.cus_telp AS customer_telp,
        CASE 
            WHEN h.sh_jenis = 0 THEN "TUNAI"
            WHEN h.sh_jenis = 1 THEN "TRANSFER"
            ELSE "GIRO"
        END AS jenisSetor,
        h.sh_nominal AS nominal,
        h.sh_ket AS keterangan,
        h.sh_akun AS akun_kode,
        r.rek_nama AS akun_nama,
        r.rek_rekening AS akun_rekening,
        h.sh_tgltransfer AS tanggalTransfer,
        h.sh_giro AS nomorGiro,
        h.sh_tglgiro AS tanggalGiro,
        h.sh_tempogiro AS tanggalJatuhTempo,
        h.sh_so_nomor AS nomorSo,
        (SELECT COUNT(*) FROM finance.tjurnal WHERE jur_nomor = h.sh_nomor) > 0 AS isPosted
    FROM tsetor_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    LEFT JOIN finance.trekening r ON r.rek_kode = h.sh_akun
    WHERE h.sh_nomor = ? AND h.sh_cab = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor, user.cabang]);
  if (headerRows.length === 0)
    throw new Error(
      "Data Setoran tidak ditemukan atau bukan milik cabang Anda."
    );

  // 2. Ambil data detail
  const itemsQuery = `
    SELECT 
        d.sd_inv AS invoice,
        d.sd_tanggal AS tglBayar,
        p.ph_tanggal AS tanggal,
        p.ph_top AS top,
        DATE_ADD(p.ph_tanggal, INTERVAL p.ph_top DAY) as jatuhTempo,
        p.ph_nominal AS nominal,
        IFNULL((SELECT SUM(pd.pd_kredit) FROM tpiutang_dtl pd WHERE pd.pd_ph_nomor = p.ph_nomor), 0) AS terbayar,
        (p.ph_nominal - IFNULL((SELECT SUM(pd.pd_kredit) FROM tpiutang_dtl pd WHERE pd.pd_ph_nomor = p.ph_nomor), 0)) AS sisa,
        d.sd_bayar AS bayar,
        d.sd_angsur AS angsur,
        d.sd_ket AS keterangan
    FROM tsetor_dtl d
    LEFT JOIN tpiutang_hdr p ON p.ph_inv_nomor = d.sd_inv
    WHERE d.sd_sh_nomor = ?;
    `;
  const [items] = await pool.query(itemsQuery, [nomor]);

  return { header: headerRows[0], items };
};

/**
 * Mengubah angka menjadi format teks Rupiah.
 * Contoh: 12345 -> "dua belas ribu tiga ratus empat puluh lima"
 */
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
    return "angka terlalu besar";
  };

  return terbilangRecursive(n).replace(/\s+/g, " ").trim();
}

const capitalize = (s) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";

const getPrintData = async (nomor) => {
  // 1. Query untuk mengambil data header
  const headerQuery = `
    SELECT 
        h.sh_nomor, h.sh_tanggal, h.sh_nominal, h.sh_ket, h.sh_jenis,
        h.sh_akun, IFNULL(r.rek_nama, '') AS rek_nama, IFNULL(h.sh_norek, '') AS sh_norek, h.sh_tgltransfer,
        h.sh_giro, h.sh_tglgiro, h.sh_tempogiro,
        h.user_create, DATE_FORMAT(h.date_create, "%d-%m-%Y %T") AS created,
        c.cus_nama, c.cus_alamat, c.cus_kota, c.cus_telp,
        src.gdg_inv_nama AS perush_nama,
        src.gdg_inv_alamat AS perush_alamat,
        src.gdg_inv_telp AS perush_telp
    FROM tsetor_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    LEFT JOIN finance.trekening r ON r.rek_kode = h.sh_akun
    LEFT JOIN tgudang src ON src.gdg_kode = h.sh_cab
    WHERE h.sh_nomor = ?;
    `;
  const [headerRows] = await pool.query(headerQuery, [nomor]);
  if (headerRows.length === 0) {
    throw new Error("Data setoran tidak ditemukan.");
  }
  const header = headerRows[0];

  // Tambahkan 'terbilang' ke objek header, sama seperti di soForm
  const nominal = parseFloat(header.sh_nominal);
  if (!isNaN(nominal)) {
    header.terbilang = capitalize(terbilang(nominal)) + " Rupiah";
  } else {
    header.terbilang = "Nominal tidak valid";
  }

  // 2. Query untuk mengambil data detail
  const detailQuery = `
    SELECT 
        d.sd_inv, 
        IFNULL(i.inv_nomor_so, "") AS so,
        d.sd_bayar,
        d.sd_ket
    FROM tsetor_dtl d
    LEFT JOIN tinv_hdr i ON i.inv_nomor = d.sd_inv
    WHERE d.sd_sh_nomor = ?
    ORDER BY d.sd_nourut;
    `;
  const [details] = await pool.query(detailQuery, [nomor]);

  // 3. Gabungkan header dan detail
  return { header, details };
};

const getExportDetails = async (filters) => {
  const { startDate, endDate, cabang } = filters;
  const query = `
    SELECT 
        h.sh_nomor AS 'Nomor Setoran',
        h.sh_tanggal AS 'Tanggal Setoran',
        c.cus_nama AS 'Customer',
        d.sd_tanggal AS 'Tgl Bayar',
        d.sd_inv AS 'Invoice',
        ph.ph_tanggal AS 'Tgl Invoice',
        d.sd_bayar AS 'Bayar',
        d.sd_ket AS 'Keterangan'
    FROM tsetor_hdr h
    JOIN tsetor_dtl d ON h.sh_nomor = d.sd_sh_nomor
    LEFT JOIN tcustomer c ON c.cus_kode = h.sh_cus_kode
    LEFT JOIN tpiutang_dtl pd ON pd.pd_sd_angsur = d.sd_angsur AND d.sd_angsur <> ""
    LEFT JOIN tpiutang_hdr ph ON ph.ph_nomor = pd.pd_ph_nomor
    WHERE h.sh_cab = ?
        AND h.sh_tanggal BETWEEN ? AND ?
    ORDER BY h.sh_nomor, d.sd_nourut;
    `;
  const [rows] = await pool.query(query, [cabang, startDate, endDate]);
  return rows;
};

const searchSoForSetoran = async ({
  customer,
  cabang,
  term,
  page,
  itemsPerPage,
}) => {
  const offset = (page - 1) * itemsPerPage;
  const search = `%${term || ""}%`;

  const query = `
    SELECT 
      h.so_nomor AS Nomor,
      h.so_tanggal AS Tanggal,
      h.so_cus_kode AS KdCus,
      c.cus_nama AS Customer
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN tinv_hdr i ON i.inv_nomor_so = h.so_nomor
    WHERE h.so_cus_kode = ?
      AND h.so_cab = ?
      AND i.inv_nomor_so IS NULL
      AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)
    ORDER BY h.so_tanggal DESC
    LIMIT ? OFFSET ?
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM tso_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.so_cus_kode
    LEFT JOIN tinv_hdr i ON i.inv_nomor_so = h.so_nomor
    WHERE h.so_cus_kode = ?
      AND h.so_cab = ?
      AND i.inv_nomor_so IS NULL
      AND (h.so_nomor LIKE ? OR c.cus_nama LIKE ?)
  `;

  const [rows] = await pool.query(query, [
    customer,
    cabang,
    search,
    search,
    itemsPerPage,
    offset,
  ]);

  const [countRows] = await pool.query(countQuery, [
    customer,
    cabang,
    search,
    search,
  ]);

  return {
    items: rows,
    total: countRows[0].total,
  };
};

const getSoDetails = async (nomorSo, user) => {
  const connection = await pool.getConnection();
  try {
    // Ambil header SO singkat (nomor, tanggal, customer kode/nama)
    const q = `
      SELECT so_nomor AS nomor, so_tanggal AS tanggal, so_cus_kode AS cus_kode, so_cus_level AS cus_level, so_cab AS cabang
      FROM tso_hdr
      WHERE so_nomor = ?
      LIMIT 1
    `;
    const [rows] = await connection.query(q, [nomorSo]);
    if (rows.length === 0) return null;

    const so = rows[0];

    // Ambil nama customer (jika ada)
    let customer = { kode: "", nama: "" };
    if (so.cus_kode) {
      const [crows] = await connection.query(
        "SELECT cus_kode, cus_nama, cus_alamat, cus_kota, cus_telp FROM tcustomer WHERE cus_kode = ?",
        [so.cus_kode]
      );
      if (crows.length > 0) {
        customer = {
          kode: crows[0].cus_kode,
          nama: crows[0].cus_nama,
          alamat: crows[0].cus_alamat || "",
          kota: crows[0].cus_kota || "",
          telp: crows[0].cus_telp || "",
        };
      }
    }

    // Hitung minimal DP (pakai fungsi calculateMinDp yang sudah ada)
    const minimalDp = await calculateMinDp(nomorSo);

    // Cek apakah SO sudah jadi invoice (ada di tinv_hdr.inv_nomor_so)
    const [invRows] = await connection.query(
      "SELECT inv_nomor FROM tinv_hdr WHERE inv_nomor_so = ? LIMIT 1",
      [nomorSo]
    );
    const isInvoiced = invRows.length > 0;

    return {
      nomor: so.nomor,
      tanggal: so.tanggal,
      customer,
      minimalDp,
      isInvoiced,
      cabang: so.cab,
    };
  } catch (error) {
    throw error;
  } finally {
    connection.release();
  }
};

const getInvoicesFromSo = async (nomorSo) => {
  const connection = await pool.getConnection();
  try {
    const q = `
      SELECT 
        h.inv_nomor AS invoice,
        h.inv_tanggal AS tanggal,
        h.inv_top AS top,
        DATE_ADD(h.inv_tanggal, INTERVAL h.inv_top DAY) AS jatuhTempo,
        h.inv_total AS nominal,
        IFNULL(h.inv_terbayar, 0) AS terbayar,
        (h.inv_total - IFNULL(h.inv_terbayar, 0)) AS sisa
      FROM tinv_hdr h
      WHERE h.inv_nomor_so = ?
      ORDER BY h.inv_nomor ASC
    `;

    const [rows] = await connection.query(q, [nomorSo]);
    return rows;
  } finally {
    connection.release();
  }
};

/**
 * Mengaktifkan SO jika total DP memenuhi minimal DP.
 */
const activateSoIfDpEnough = async (connection, nomorSo, shNomor, user) => {
  if (!nomorSo) return;

  // 1. Hitung total DP yang sudah dibayarkan berdasarkan header setoran.
  const dpQuery = `
    SELECT IFNULL(SUM(sh_nominal), 0) AS totalDp
    FROM tsetor_hdr
    WHERE sh_so_nomor = ?;
  `;
  const [dpRows] = await connection.query(dpQuery, [nomorSo]);
  const totalDp = Number(dpRows[0].totalDp || 0);

  // 2. Hitung minimal DP (30% total SO)
  const minimalDp = await calculateMinDp(nomorSo);

  // 3. Ambil status SO saat ini
  const [soRows] = await connection.query(
    `SELECT so_aktif FROM tso_hdr WHERE so_nomor = ? LIMIT 1`,
    [nomorSo]
  );
  if (soRows.length === 0) return;

  const currentStatus = soRows[0].so_aktif;

  // 4. Jika total DP memenuhi dan SO masih belum aktif → aktifkan
  if (totalDp >= minimalDp && currentStatus !== "Y") {
    await connection.query(
      `
      UPDATE tso_hdr
      SET 
        so_aktif = 'Y',
        so_nodp = ?,       -- nomor setoran DP terakhir
        so_accdp = ?,      -- user yang ACC DP
        so_dp = ?          -- total DP yang sudah dibayar
      WHERE so_nomor = ?;
      `,
      [shNomor, user.kode, totalDp, nomorSo]
    );

    console.log(`SO ${nomorSo} DISET AKTIF karena DP >= minimal DP`);
  }
};

module.exports = {
  saveData,
  searchUnpaidInvoices,
  loadForEdit,
  getPrintData,
  getExportDetails,
  searchSoForSetoran,
  getSoDetails,
  getInvoicesFromSo,
  activateSoIfDpEnough,
};
