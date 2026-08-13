const express = require("express");
const router = express.Router();
const priceProposalController = require("../controllers/priceProposalController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const PRICE_PROPOSAL_MENU_ID = 38;

router.get(
  "/",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "view"),
  priceProposalController.getAll,
);
router.get(
  "/so-dateline-range",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "view"),
  priceProposalController.getDatelineRange,
);
router.get(
  "/:nomor/size-details",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "view"),
  priceProposalController.getSizeDetails,
);
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "view"),
  priceProposalController.getDetails,
);
router.get(
  "/:nomor/status-history",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "view"),
  priceProposalController.getStatusHistory,
);

router.patch(
  "/:nomor/approve-customer",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.approveCustomer,
);
router.patch(
  "/:nomor/approve-finance",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.approveFinance,
);
router.patch(
  "/:nomor/approve-dc",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.approveDc,
);
router.patch(
  "/:nomor/reject",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.reject,
);
router.patch(
  "/:nomor/ready-store",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.markReadyStore,
);

router.get(
  "/:nomor/so-eligibility",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "view"),
  priceProposalController.getSoEligibility,
);
router.get(
  "/:nomor/so-prefill",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.getSoPrefill,
);
router.post(
  "/:nomor/generate-so",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.generateSalesOrder,
);
router.get(
  "/:nomor/so-detail",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.getSalesOrderForEdit,
);
router.put(
  "/:nomor/so-detail",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalController.updateSalesOrder,
);

router.delete(
  "/:nomor",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "delete"),
  priceProposalController.remove,
);

module.exports = router;
