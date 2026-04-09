const pettyCashService = require("../services/pettyCashService");
const pool = require("../config/database");

const getList = async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      cabang: req.query.cabang,
    };
    const data = await pettyCashService.getList(filters);
    res.json(data);
  } catch (error) {
    console.error("Error getList Petty Cash:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada server." });
  }
};

const submitData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const userKode = req.user.kode; // Ambil kode user dari token (verifyToken)

    const result = await pettyCashService.submitData(nomor, userKode);
    res.json(result);
  } catch (error) {
    console.error("Error submit Petty Cash:", error);

    // Jika error berasal dari lemparan throw new Error di service (status 400)
    if (error.message.includes("Gagal submit")) {
      return res.status(400).json({ message: error.message });
    }

    // Jika error murni dari server/database (status 500)
    res
      .status(500)
      .json({ message: "Terjadi kesalahan pada server saat submit data." });
  }
};

const submitKlaimKolektif = async (req, res) => {
  try {
    const result = await pettyCashService.submitKlaimKolektif(
      req.body,
      req.user,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getDraftsForKlaim = async (req, res) => {
  try {
    // Ambil dari query string
    const filters = {
      cabang: req.user.cabang,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    };
    const data = await pettyCashService.getDraftsForKlaim(filters);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const accKlaim = async (req, res) => {
  try {
    const { pck_nomor } = req.params;
    const { approver } = req.body; // Didapat dari hasil input PIN SPV

    if (!approver)
      return res.status(400).json({ message: "Nama Approver tidak valid." });

    const result = await pettyCashService.accKlaim(
      pck_nomor,
      approver,
      req.user,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getListKlaimFinance = async (req, res) => {
  try {
    const data = await pettyCashService.getListKlaimFinance(req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Gagal menarik data klaim." });
  }
};

const getDetailKlaimFinance = async (req, res) => {
  try {
    const data = await pettyCashService.getDetailKlaimFinance(
      req.params.pck_nomor,
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Gagal menarik detail rincian nota." });
  }
};

const getKlaimKolektifDetail = async (req, res) => {
  try {
    const data = await pettyCashService.getKlaimKolektifDetail(
      req.params.pck_nomor,
    );
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const approveKlaimKolektif = async (req, res) => {
  try {
    const { catatan } = req.body;
    const result = await pettyCashService.approveKlaimKolektif(
      req.params.pck_nomor,
      req.user,
      catatan,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const receiveKlaim = async (req, res) => {
  try {
    const result = await pettyCashService.receiveKlaim(
      req.params.pck_nomor,
      req.body,
      req.user,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const rejectKlaimKolektif = async (req, res) => {
  try {
    const { alasan } = req.body;
    const result = await pettyCashService.rejectKlaimKolektif(
      req.params.pck_nomor,
      req.user,
      alasan,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const rejectSinglePc = async (req, res) => {
  try {
    const { pck_nomor, pc_nomor } = req.params;
    const { alasan } = req.body;
    const result = await pettyCashService.rejectSinglePc(
      pck_nomor,
      pc_nomor,
      req.user,
      alasan,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const transferKlaim = async (req, res) => {
  try {
    const { pck_nomor } = req.params;
    const { pth_nomor } = req.body; // Nomor dari program Delphi yang diinput user
    const result = await pettyCashService.transferKlaimKolektif(
      pck_nomor,
      pth_nomor,
      req.user,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const deleteData = async (req, res) => {
  try {
    const { nomor } = req.params;
    // Panggil service untuk menghapus data, lempar juga info user yang menghapus
    const result = await pettyCashService.deleteData(nomor, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getList,
  submitData, // Jangan lupa di-export
  submitKlaimKolektif,
  getDraftsForKlaim,
  accKlaim,
  getListKlaimFinance,
  getDetailKlaimFinance,
  getKlaimKolektifDetail,
  approveKlaimKolektif,
  receiveKlaim,
  rejectKlaimKolektif,
  rejectSinglePc,
  transferKlaim,
  deleteData,
};
