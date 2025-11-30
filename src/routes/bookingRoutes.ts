import express from "express";
import { protect } from "../middleware/authMiddleware";

// Direct booking
import { createDirectBooking } from "../controllers/Booking/directBooking";

// Game-based booking
import { startGameBooking } from "../controllers/Booking/gameBooking";

// Get my venue bookings
import { getMyVenueBookings } from "../controllers/Booking/getMyVenueBooking";

// Verify payment
import { verifyPayment } from "../controllers/Booking/verifyPayment";

// Stripe webhook
import { stripeWebhook } from "../controllers/payment/stripeWebhook";

// Retry payment
import { retryPayment } from "../controllers/Booking/retryPayment";

// Get calendar link
import { getCalendarLink } from "../controllers/Booking/getCalendarLink";

const router: express.Router = express.Router();

router.get(
  "/my-bookings",
  protect,
  getMyVenueBookings
);

router.get(
  "/verify-payment",
  protect,
  verifyPayment
);

router.post(
  "/direct",
  protect,
  createDirectBooking
);

router.post(
  "/game/:gameId",
  protect,
  startGameBooking
);

router.post(
  "/retry",
  protect,
  retryPayment
);

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

router.get(
  "/:bookingId/calendar",
  protect,
  getCalendarLink
);

export default router;