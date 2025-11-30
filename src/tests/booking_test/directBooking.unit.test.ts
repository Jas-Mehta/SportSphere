import { Request, Response, NextFunction } from 'express';
import { createDirectBooking } from '../../controllers/Booking/directBooking';
import TimeSlot from '../../models/TimeSlot';
import Booking from '../../models/Booking';
import SubVenue from '../../models/SubVenue';
import Venue from '../../models/Venue';
import AppError from '../../utils/AppError';
import mongoose from 'mongoose';

// Mock dependencies
jest.mock('../../models/TimeSlot');
jest.mock('../../models/Booking');
jest.mock('../../models/SubVenue');
jest.mock('../../models/Venue');
jest.mock('../../config/logger', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
        debug: jest.fn()
    }
}));

const mockStripeSessionCreate = jest.fn();
jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
        checkout: {
            sessions: {
                create: mockStripeSessionCreate,
            },
        },
    }));
});

describe('createDirectBooking - Unit Tests', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        process.env.STRIPE_SECRET_KEY = 'test_secret';
        process.env.FRONTEND_URL = 'http://localhost:3000';

        req = {
            body: {},
            user: { _id: 'user123' }
        } as unknown as Request;

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        } as Partial<Response>;

        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('Validation: Missing STRIPE_SECRET_KEY', () => {
        it('should throw error when STRIPE_SECRET_KEY is not set', async () => {
            delete process.env.STRIPE_SECRET_KEY;

            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Cricket'
            };

            const mockSlot = {
                _id: 'slot123',
                startTime: new Date(Date.now() + 86400000),
                endTime: new Date(Date.now() + 90000000),
                prices: { Cricket: 1000 },
                status: 'available',
                bookedForSport: null
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (SubVenue.findById as jest.Mock).mockResolvedValue({
                _id: 'subVenue123',
                venue: 'venue123'
            });

            (Venue.findById as jest.Mock).mockResolvedValue({
                _id: 'venue123',
                location: { coordinates: [0, 0] }
            });

            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: [mockSlot]
            });

            await createDirectBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toContain('STRIPE_SECRET_KEY is not set');
            expect(error.statusCode).toBe(500);
        });
    });

    describe('Validation: TimeSlot Not Found', () => {
        it('should throw 404 error when TimeSlot document does not exist', async () => {
            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Cricket'
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue(null);

            await createDirectBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('TimeSlot document not found');
            expect(error.statusCode).toBe(404);
        });
    });

    describe('Validation: Slot Not Found in Document', () => {
        it('should throw 404 error when slot ID does not exist in TimeSlot', async () => {
            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'invalidSlotId',
                sport: 'Cricket'
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(null) // Slot not found
                }
            });

            await createDirectBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('Slot not found');
            expect(error.statusCode).toBe(404);
        });
    });

    describe('Validation: Price Not Available for Sport', () => {
        it('should throw 400 error when sport price is not available', async () => {
            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Football' // Sport not in prices
            };

            const mockSlot = {
                _id: 'slot123',
                startTime: new Date(Date.now() + 86400000),
                endTime: new Date(Date.now() + 90000000),
                prices: { Cricket: 1000 }, // Only Cricket available
                status: 'available',
                bookedForSport: null
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            await createDirectBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('Sport price not available for this slot');
            expect(error.statusCode).toBe(400);
        });
    });

    describe('Logic: Map vs Object Prices', () => {
        it('should handle prices as Map type', async () => {
            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Cricket'
            };

            const pricesMap = new Map();
            pricesMap.set('Cricket', 1000);

            const mockSlot = {
                _id: 'slot123',
                startTime: new Date(Date.now() + 86400000),
                endTime: new Date(Date.now() + 90000000),
                prices: pricesMap, // Map type
                status: 'available',
                bookedForSport: null
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (SubVenue.findById as jest.Mock).mockResolvedValue({
                _id: 'subVenue123',
                venue: 'venue123'
            });

            (Venue.findById as jest.Mock).mockResolvedValue({
                _id: 'venue123',
                location: { coordinates: [0, 0] }
            });

            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: [mockSlot]
            });

            mockStripeSessionCreate.mockResolvedValue({
                id: 'sess_123',
                url: 'http://stripe.com/pay'
            });

            (Booking.create as jest.Mock).mockResolvedValue({
                _id: 'booking123',
                status: 'Pending',
                stripeSessionId: 'sess_123'
            });

            await createDirectBooking(req as Request, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(mockStripeSessionCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    line_items: [
                        expect.objectContaining({
                            price_data: expect.objectContaining({
                                unit_amount: 100000 // 1000 * 100
                            })
                        })
                    ]
                })
            );
        });
    });

    describe('Validation: SubVenue Not Found', () => {
        it('should throw 404 error when SubVenue does not exist', async () => {
            req.body = {
                subVenueId: 'invalidSubVenue',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Cricket'
            };

            const mockSlot = {
                _id: 'slot123',
                startTime: new Date(Date.now() + 86400000),
                endTime: new Date(Date.now() + 90000000),
                prices: { Cricket: 1000 },
                status: 'available',
                bookedForSport: null
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (SubVenue.findById as jest.Mock).mockResolvedValue(null);

            await createDirectBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('SubVenue not found');
            expect(error.statusCode).toBe(404);
        });
    });

    describe('Validation: Venue Not Found', () => {
        it('should throw 404 error when Venue does not exist', async () => {
            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Cricket'
            };

            const mockSlot = {
                _id: 'slot123',
                startTime: new Date(Date.now() + 86400000),
                endTime: new Date(Date.now() + 90000000),
                prices: { Cricket: 1000 },
                status: 'available',
                bookedForSport: null
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (SubVenue.findById as jest.Mock).mockResolvedValue({
                _id: 'subVenue123',
                venue: 'invalidVenue'
            });

            (Venue.findById as jest.Mock).mockResolvedValue(null);

            await createDirectBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('Venue not found');
            expect(error.statusCode).toBe(404);
        });
    });

    describe('Error Handling: Atomic Lock Fails', () => {
        it('should throw error when slot cannot be locked (race condition)', async () => {
            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Cricket'
            };

            const mockSlot = {
                _id: 'slot123',
                startTime: new Date(Date.now() + 86400000),
                endTime: new Date(Date.now() + 90000000),
                prices: { Cricket: 1000 },
                status: 'available',
                bookedForSport: null
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (SubVenue.findById as jest.Mock).mockResolvedValue({
                _id: 'subVenue123',
                venue: 'venue123'
            });

            (Venue.findById as jest.Mock).mockResolvedValue({
                _id: 'venue123',
                location: { coordinates: [0, 0] }
            });

            // Atomic lock fails (returns null)
            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

            await createDirectBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('Slot is no longer available');
            expect(error.statusCode).toBe(400);
        });
    });

    describe('Error Handling: Booking Creation Fails After Lock', () => {
        it('should rollback slot lock when Booking.create fails', async () => {
            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Cricket'
            };

            const mockSlot = {
                _id: 'slot123',
                startTime: new Date(Date.now() + 86400000),
                endTime: new Date(Date.now() + 90000000),
                prices: { Cricket: 1000 },
                status: 'available',
                bookedForSport: null
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (SubVenue.findById as jest.Mock).mockResolvedValue({
                _id: 'subVenue123',
                venue: 'venue123'
            });

            (Venue.findById as jest.Mock).mockResolvedValue({
                _id: 'venue123',
                location: { coordinates: [0, 0] }
            });

            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: [mockSlot]
            });

            mockStripeSessionCreate.mockResolvedValue({
                id: 'sess_123',
                url: 'http://stripe.com/pay'
            });

            // Booking.create fails
            (Booking.create as jest.Mock).mockRejectedValue(new Error('Database error'));

            await createDirectBooking(req as Request, res as Response, next);

            // Verify rollback was called
            expect(TimeSlot.findOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ _id: 'tsDoc123', 'slots._id': 'slot123' }),
                expect.objectContaining({
                    $set: expect.objectContaining({
                        'slots.$.status': 'available',
                        'slots.$.bookedForSport': null
                    })
                })
            );

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('Success: Logger Called on Successful Booking', () => {
        it('should call logger.info when booking is created successfully', async () => {
            const logger = require('../../config/logger').default;

            req.body = {
                subVenueId: 'subVenue123',
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                sport: 'Cricket'
            };

            const mockSlot = {
                _id: 'slot123',
                startTime: new Date(Date.now() + 86400000),
                endTime: new Date(Date.now() + 90000000),
                prices: { Cricket: 1000 },
                status: 'available',
                bookedForSport: null
            };

            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (SubVenue.findById as jest.Mock).mockResolvedValue({
                _id: 'subVenue123',
                venue: 'venue123'
            });

            (Venue.findById as jest.Mock).mockResolvedValue({
                _id: 'venue123',
                location: { coordinates: [0, 0] }
            });

            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: [mockSlot]
            });

            mockStripeSessionCreate.mockResolvedValue({
                id: 'sess_123',
                url: 'http://stripe.com/pay'
            });

            const mockBookingId = new mongoose.Types.ObjectId();
            (Booking.create as jest.Mock).mockResolvedValue({
                _id: mockBookingId,
                status: 'Pending',
                stripeSessionId: 'sess_123'
            });

            await createDirectBooking(req as Request, res as Response, next);

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Booking created:')
            );
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('user123')
            );
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Status: Pending')
            );
        });
    });
});
