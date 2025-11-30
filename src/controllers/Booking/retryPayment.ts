import asyncHandler from "express-async-handler";
import { Response, RequestHandler } from "express";
import { IUserRequest } from "../../middleware/authMiddleware";
import AppError from "../../utils/AppError";
import Booking from "../../models/Booking";
import TimeSlot from "../../models/TimeSlot";
import Game from "../../models/gameModels";
import Stripe from "stripe";
import mongoose from "mongoose";
import logger from "../../config/logger";

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

export const retryPayment: RequestHandler = asyncHandler(async (req: IUserRequest, res: Response): Promise<void> => {
    const { bookingId } = req.body;
    const userId = req.user._id;

    if (!bookingId) {
        throw new AppError("Booking ID is required", 400);
    }

    const booking = await Booking.findOne({ _id: bookingId, user: userId });
    if (!booking) {
        throw new AppError("Booking not found", 404);
    }

    if (booking.status === "Paid") {
        throw new AppError("Booking is already paid", 400);
    }

    // Check if booking time has passed
    if (new Date(booking.startTime) < new Date()) {
        throw new AppError("Cannot retry payment for a past booking", 400);
    }

    // If booking is Failed, we need to check if the slot is still available and re-lock it
    if (booking.status === "Failed" || booking.status === "Pending") {
        if (!booking.subVenueId) {
            throw new AppError("Invalid booking: missing subVenueId", 400);
        }

        const dateStr = booking.startTime.toISOString().split('T')[0];

        // We need to find the slot ID first to construct the query
        // Since we don't store slotId on booking, we find it by time
        const ts = await TimeSlot.findOne({
            subVenue: booking.subVenueId,
            date: dateStr
        });

        if (!ts) throw new AppError("TimeSlot not found", 404);

        const slot = (ts.slots as mongoose.Types.DocumentArray<any>).find(s =>
            new Date(s.startTime).getTime() === new Date(booking.startTime).getTime() &&
            new Date(s.endTime).getTime() === new Date(booking.endTime).getTime()
        );

        if (!slot) throw new AppError("Slot not found", 404);

        let didLock = false;

        if (booking.status === "Failed") {
            // Atomic Lock: Must be available
            const lockedTs = await TimeSlot.findOneAndUpdate(
                {
                    _id: ts._id,
                    "slots._id": slot._id,
                    "slots.status": "available"
                },
                {
                    $set: {
                        "slots.$.status": "booked",
                        "slots.$.bookedForSport": booking.sport
                    }
                },
                { new: true }
            );

            if (!lockedTs) {
                throw new AppError("Slot is no longer available", 400);
            }
            didLock = true;
        } else if (booking.status === "Pending") {
            // Try to lock if available (in case it was released)
            const lockedTs = await TimeSlot.findOneAndUpdate(
                {
                    _id: ts._id,
                    "slots._id": slot._id,
                    "slots.status": "available"
                },
                {
                    $set: {
                        "slots.$.status": "booked",
                        "slots.$.bookedForSport": booking.sport
                    }
                },
                { new: true }
            );

            if (lockedTs) {
                didLock = true;
            } else {
                // If not available, verify it is booked (presumably by us)
                // We need to refresh 'ts' to check current status
                const currentTs = await TimeSlot.findById(ts._id);
                const currentSlot = (currentTs?.slots as mongoose.Types.DocumentArray<any>).id(slot._id);

                if (!currentSlot || currentSlot.status !== "booked") {
                    throw new AppError("Slot is not available for retry", 400);
                }
                // If booked, we proceed (assuming it's this booking)
            }
        }

        try {
            // Create new Stripe session
            const stripeClient = getStripe();

            const session = await stripeClient.checkout.sessions.create({
                mode: "payment",
                payment_method_types: ["card"],
                line_items: [
                    {
                        price_data: {
                            currency: booking.currency,
                            unit_amount: booking.amount, // Amount is in paise
                            product_data: { name: `Booking Retry - ${booking.sport || 'Venue'}` },
                        },
                        quantity: 1,
                    },
                ],
                metadata: {
                    type: "retry",
                    userId: userId.toString(),
                    bookingId: (booking._id as mongoose.Types.ObjectId).toString(),
                },
                success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.FRONTEND_URL}/payment-cancel`,
            });

            // Update booking with new session ID
            booking.stripeSessionId = session.id;
            // If it was Failed, set back to Pending
            booking.status = "Pending";
            await booking.save();

            // If this is a Game booking, mark Game as Full again
            if (booking.gameId) {
                const game = await Game.findById(booking.gameId);
                if (game) {
                    game.status = 'Full';
                    await game.save();
                    logger.info(`Game ${game._id} marked as Full (retry payment)`);
                }
            }

            logger.info(`Booking retry initiated: ${booking._id} [User: ${userId}, New Session: ${session.id}]`);

            res.json({
                success: true,
                url: session.url,
                bookingId: booking._id,
            });

        } catch (error) {
            // Rollback: Only unlock if WE locked it
            if (didLock) {
                await TimeSlot.findOneAndUpdate(
                    { _id: ts._id, "slots._id": slot._id },
                    {
                        $set: {
                            "slots.$.status": "available",
                            "slots.$.bookedForSport": null
                        }
                    }
                );
            }
            throw error;
        }
    } else {
        // Should not happen given checks above
        throw new AppError("Invalid booking status for retry", 400);
    }
});
