import { Request, Response } from "express";
import Stripe from "stripe";
import AppError from "../../utils/AppError";
import logger from "../../config/logger";
import Booking from "../../models/Booking";
import TimeSlot from "../../models/TimeSlot";
import Game from "../../models/gameModels";
import { generateGoogleCalendarLink } from "../../utils/generateGoogleCalendarLink";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"] as string;

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    logger.error(`Stripe Webhook Signature Error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  logger.info(`Webhook received: ${event.type} [ID: ${event.id}]`);

  if (event.type.startsWith('checkout.session')) {
    const session = event.data.object as Stripe.Checkout.Session;
    logger.info(`Session ID: ${session.id}, Status: ${session.payment_status}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        const session = event.data.object as Stripe.Checkout.Session;
        logger.info(`Checkout session completed: ${session.id}`);

        // Find and update the booking
        const booking = await Booking.findOne({ stripeSessionId: session.id });

        if (booking) {
          booking.status = "Paid";
          booking.stripePaymentIntentId = session.payment_intent as string;
          await booking.save();
          logger.info(`Booking ${booking._id} marked as Paid`);

          // Update Game Status if applicable
          if (session.metadata && session.metadata.type === "game" && session.metadata.gameId) {
            const game = await Game.findById(session.metadata.gameId);
            if (game) {
              game.bookingStatus = "Booked";
              await game.save();
              logger.info(`Game ${game._id} booking status updated to Booked`);
            }
          }
        } else {
          logger.warn(`No booking found for session ${session.id}`);
        }
        break;

      case "checkout.session.expired":
        const expiredSession = event.data.object as Stripe.Checkout.Session;
        logger.info(`Checkout session expired: ${expiredSession.id}`);

        // Mark booking as failed and release slot
        const expiredBooking = await Booking.findOne({ stripeSessionId: expiredSession.id });
        if (expiredBooking) {
          expiredBooking.status = "Failed";
          await expiredBooking.save();
          logger.info(`Booking ${expiredBooking._id} marked as Failed (expired)`);

          // Reset Game Status if applicable
          if (expiredSession.metadata && expiredSession.metadata.gameId) {
            const game = await Game.findById(expiredSession.metadata.gameId);
            if (game) {
              game.status = 'Open';
              await game.save();
              logger.info(`Game ${game._id} status reset to Open (booking expired)`);
            }
          }
        }

        // Release the slot using metadata (Robust method)
        if (expiredSession.metadata && expiredSession.metadata.timeSlotDocId && expiredSession.metadata.slotId) {
          const { timeSlotDocId, slotId } = expiredSession.metadata;

          await TimeSlot.findOneAndUpdate(
            { _id: timeSlotDocId, "slots._id": slotId },
            {
              $set: {
                "slots.$.status": "available",
                "slots.$.bookedForSport": null
              }
            }
          );
          logger.info(`Slot released via metadata for session ${expiredSession.id}`);
        } else if (expiredBooking && expiredBooking.subVenueId) {
          // Fallback: Release the slot using booking data (Fragile method)
          const dateStr = expiredBooking.startTime.toISOString().split('T')[0]; // YYYY-MM-DD

          const timeSlot = await TimeSlot.findOne({
            subVenue: expiredBooking.subVenueId,
            date: dateStr
          });

          if (timeSlot) {
            // Find the specific slot
            const slotIndex = timeSlot.slots.findIndex((s: any) =>
              new Date(s.startTime).getTime() === new Date(expiredBooking.startTime).getTime() &&
              new Date(s.endTime).getTime() === new Date(expiredBooking.endTime).getTime()
            );

            if (slotIndex !== -1) {
              timeSlot.slots[slotIndex].status = "available";
              timeSlot.slots[slotIndex].bookedForSport = null;
              await timeSlot.save();
              logger.info(`Slot released via fallback for booking ${expiredBooking._id}`);
            }
          }
        }
        break;

      case "payment_intent.payment_failed":
        const failedPayment = event.data.object as Stripe.PaymentIntent;
        logger.error(`Payment failed: ${failedPayment.id}`);

        // Find booking by payment intent if possible, or we might need to rely on session lookup if we stored it
        // Usually checkout.session.expired handles the abandonment. 
        // If payment explicitly fails, we might want to keep it as Pending/Failed to allow retry, 
        // OR release it immediately. For now, let's treat it similar to expiry if we can link it.
        // But typically we link via session ID. 
        // Let's just log it for now as the session expiry is the main cleanup mechanism for checkout flow.
        break;

      case "payment_intent.succeeded":
        logger.info(`Payment succeeded: ${event.data.object.id}`);
        break;

      default:
        logger.warn(`Unhandled event type ${event.type}`);
    }
  } catch (err: any) {
    logger.error(`Error processing webhook: ${err.message}`);
    res.status(500).send(`Webhook processing error: ${err.message}`);
    return;
  }

  res.sendStatus(200);
  return;
};
