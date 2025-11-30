import asyncHandler from "express-async-handler";
import { Response, RequestHandler } from "express";
import { IUserRequest } from "../../middleware/authMiddleware";
import AppError from "../../utils/AppError";

import TimeSlot from "../../models/TimeSlot";
import Venue from "../../models/Venue";
import SubVenue from "../../models/SubVenue";
import Booking from "../../models/Booking";

import Stripe from "stripe";
import mongoose from "mongoose";
import logger from "../../config/logger";

// Lazy-load Stripe to ensure env vars are loaded
let stripe: Stripe;
const getStripe = () => {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new AppError('STRIPE_SECRET_KEY is not set in environment variables', 500);
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
};

export const createDirectBooking: RequestHandler = asyncHandler(async (req: IUserRequest, res: Response): Promise<void> => {
  const { subVenueId, timeSlotDocId, slotId, sport } = req.body;
  const userId = req.user._id;


  if (!subVenueId || !timeSlotDocId || !slotId || !sport) {
    throw new AppError("Missing required fields", 400);
  }

  // Validate the timeslot
  const ts = await TimeSlot.findById(timeSlotDocId);
  if (!ts) throw new AppError("TimeSlot document not found", 404);

  const slot = (ts.slots as mongoose.Types.DocumentArray<any>).id(slotId);
  if (!slot) throw new AppError("Slot not found", 404);

  if (slot.status !== "available") {
    throw new AppError("Slot is no longer available", 400);
  }

  // Check if slot is in the past
  if (new Date(slot.startTime) < new Date()) {
    throw new AppError("Cannot book a slot in the past", 400);
  }

  // Handle Mongoose Map type for prices
  let price: number | undefined;
  if (slot.prices instanceof Map) {
    price = slot.prices.get(sport);
  } else {
    // If it's already a plain object
    price = (slot.prices as any)[sport];
  }
  if (!price) throw new AppError("Sport price not available for this slot", 400);

  // Convert price to paise (Stripe requires smallest currency unit)
  const priceInPaise = price * 100;

  // Fetch subvenue → venue
  const subVenue = await SubVenue.findById(subVenueId);
  if (!subVenue) throw new AppError("SubVenue not found", 404);

  const venue = await Venue.findById(subVenue.venue);
  if (!venue) throw new AppError("Venue not found", 404);

  // Atomic Lock: Try to lock the slot only if it is available
  const lockedTs = await TimeSlot.findOneAndUpdate(
    {
      _id: timeSlotDocId,
      "slots._id": slotId,
      "slots.status": "available"
    },
    {
      $set: {
        "slots.$.status": "booked",
        "slots.$.bookedForSport": sport
      }
    },
    { new: true }
  );

  if (!lockedTs) {
    throw new AppError("Slot is no longer available", 400);
  }

  try {
    // Pre-generate Booking ID
    const bookingId = new mongoose.Types.ObjectId();

    // Check if we should bypass Stripe (for demo/showcase)
    const bypassStripe = process.env.BYPASS_STRIPE_PAYMENT === 'true';

    let session: any = null;
    let stripeSessionId: string;
    let stripePaymentIntentId: string | undefined;
    let bookingStatus: string;

    if (bypassStripe) {
      // DEMO MODE: Skip Stripe, create booking directly as paid
      logger.info(`[DEMO MODE] Bypassing Stripe payment for booking ${bookingId}`);
      stripeSessionId = `demo_session_${bookingId}`;
      stripePaymentIntentId = `demo_payment_${bookingId}`;
      bookingStatus = "Paid";
    } else {
      // NORMAL MODE: Create Stripe session
      const stripeClient = getStripe();
      session = await stripeClient.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes from now

        line_items: [
          {
            price_data: {
              currency: "inr",
              unit_amount: priceInPaise,
              product_data: { name: `Direct Venue Booking - ${sport}` },
            },
            quantity: 1,
          },
        ],

        metadata: {
          type: "direct",
          userId: userId.toString(),
          bookingId: bookingId.toString(),
          timeSlotDocId: timeSlotDocId.toString(),
          slotId: slotId.toString()
        },

        success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/payment-cancel`,
      });

      stripeSessionId = session.id;
      bookingStatus = "Pending";
    }

    // Create Booking record
    const booking = await Booking.create({
      _id: bookingId,
      user: userId,
      venueId: venue._id,
      subVenueId: subVenueId,
      sport: sport,
      coordinates: {
        type: "Point",
        coordinates: venue.location.coordinates, // immutable snapshot
      },
      startTime: slot.startTime,
      endTime: slot.endTime,
      timeSlotDocId,
      slotId,
      amount: priceInPaise,
      currency: "inr",

      stripeSessionId: stripeSessionId,
      stripePaymentIntentId: stripePaymentIntentId,
      status: bookingStatus,
    });

    logger.info(`Booking created: ${booking._id} [User: ${userId}, Status: ${bookingStatus}]`);

    if (bypassStripe) {
      // DEMO MODE: Return success without Stripe URL
      res.status(201).json({
        success: true,
        message: "Booking confirmed (Demo mode - payment bypassed)",
        bookingId: booking._id,
        demoMode: true,
        redirectUrl: "/my-bookings", // Frontend should redirect here
        booking: {
          id: booking._id,
          status: booking.status,
          sport: booking.sport,
          startTime: booking.startTime,
          endTime: booking.endTime,
          amount: booking.amount / 100,
        }
      });
    } else {
      // NORMAL MODE: Return Stripe checkout URL
      res.status(201).json({
        success: true,
        url: session.url,
        bookingId: booking._id,
      });
    }
  } catch (error) {
    // Rollback: Unlock the slot if anything fails after locking
    await TimeSlot.findOneAndUpdate(
      { _id: timeSlotDocId, "slots._id": slotId },
      {
        $set: {
          "slots.$.status": "available",
          "slots.$.bookedForSport": null
        }
      }
    );
    throw error;
  }
});