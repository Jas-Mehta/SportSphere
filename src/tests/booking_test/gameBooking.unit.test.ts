import { Request, Response, NextFunction } from 'express';
import { startGameBooking } from '../../controllers/Booking/gameBooking';
import Game from '../../models/gameModels';
import TimeSlot from '../../models/TimeSlot';
import Booking from '../../models/Booking';
import AppError from '../../utils/AppError';
import mongoose from 'mongoose';

// Mock dependencies
jest.mock('../../models/gameModels');
jest.mock('../../models/TimeSlot');
jest.mock('../../models/Booking');

// Mock Stripe - create mock inline to avoid hoisting issues
jest.mock('stripe', () => {
    const mockCreate = jest.fn();
    const MockStripe = jest.fn().mockImplementation(() => ({
        checkout: {
            sessions: {
                create: mockCreate,
            },
        },
    }));
    // Attach the mock to the constructor so we can access it in tests
    (MockStripe as any).mockSessionCreate = mockCreate;
    return MockStripe;
});

import Stripe from 'stripe';
// Get the mock function from the mocked Stripe constructor
const mockSessionCreate = (Stripe as any).mockSessionCreate;

describe('startGameBooking - Unit Tests', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        process.env.STRIPE_SECRET_KEY = 'test_secret';
        process.env.FRONTEND_URL = 'http://localhost:3000';

        req = {
            params: { gameId: 'game123' },
            user: { _id: '507f1f77bcf86cd799439012' } // Use valid ObjectId string
        } as unknown as Request;

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        } as Partial<Response>;

        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('Validation: Game Not Found', () => {
        it('should throw 404 error when game does not exist', async () => {
            (Game.findById as jest.Mock).mockResolvedValue(null);

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('Game not found');
            expect(error.statusCode).toBe(404);
        });
    });

    describe('Validation: User Is Not Host', () => {
        it('should throw 403 error when user is not the game host', async () => {
            const mockGame = {
                _id: 'game123',
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439099'), // Different from user ID
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2', 'player3'],
                playersNeeded: { min: 2, max: 10 }
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('Only the host can start booking');
            expect(error.statusCode).toBe(403);
        });
    });

    describe('Validation: Game Already Booked or Completed', () => {
        it('should throw 400 error when game is already booked', async () => {
            const mockGame = {
                _id: 'game123',
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'Booked', // Already booked
                approvedPlayers: ['player1', 'player2'],
                playersNeeded: { min: 2, max: 10 }
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('This game is already booked or completed');
            expect(error.statusCode).toBe(400);
        });

        it('should throw 400 error when game is completed', async () => {
            const mockGame = {
                _id: 'game123',
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Completed', // Completed
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2'],
                playersNeeded: { min: 2, max: 10 }
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('This game is already booked or completed');
            expect(error.statusCode).toBe(400);
        });
    });

    describe('Validation: Insufficient Players', () => {
        it('should throw 400 error when not enough players have joined', async () => {
            const mockGame = {
                _id: 'game123',
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1'], // Only 1 player
                playersNeeded: { min: 3, max: 10 } // Need at least 3
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toContain('Need at least 3 players to book');
            expect(error.statusCode).toBe(400);
        });
    });

    describe('Validation: TimeSlot Not Found', () => {
        it('should throw 400 error when TimeSlot document does not exist', async () => {
            const mockGame = {
                _id: 'game123',
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2', 'player3'],
                playersNeeded: { min: 2, max: 10 },
                slot: {
                    timeSlotDocId: 'tsDoc123',
                    slotId: 'slot123',
                    price: 500
                },
                sport: 'cricket'
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);
            // Atomic lock will fail if TimeSlot doesn't exist
            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            // Controller uses atomic locking, so it returns generic error
            expect(error.message).toBe('Slot is no longer available');
            expect(error.statusCode).toBe(400);
        });
    });

    describe('Validation: Slot Not Found in Document', () => {
        it('should throw 400 error when slot ID does not exist in TimeSlot', async () => {
            const mockGame = {
                _id: 'game123',
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2', 'player3'],
                playersNeeded: { min: 2, max: 10 },
                slot: {
                    timeSlotDocId: 'tsDoc123',
                    slotId: 'invalidSlot',
                    price: 500
                },
                sport: 'cricket'
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);
            // Atomic lock will fail if slot doesn't exist
            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            // Controller uses atomic locking, so it returns generic error
            expect(error.message).toBe('Slot is no longer available');
            expect(error.statusCode).toBe(400);
        });
    });

    describe('Validation: Slot Not Available', () => {
        it('should throw 400 error when slot is already booked', async () => {
            const mockGame = {
                _id: 'game123',
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2', 'player3'],
                playersNeeded: { min: 2, max: 10 },
                slot: {
                    timeSlotDocId: 'tsDoc123',
                    slotId: 'slot123',
                    price: 500
                },
                sport: 'cricket'
            };

            const mockSlot = {
                _id: 'slot123',
                status: 'booked', // Already booked
                startTime: new Date(),
                endTime: new Date()
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);
            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('Slot is no longer available');
            expect(error.statusCode).toBe(400);
        });
    });

    describe('Error Handling: Atomic Lock Fails', () => {
        it('should throw error when slot cannot be locked (race condition)', async () => {
            const mockGame = {
                _id: 'game123',
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2', 'player3'],
                playersNeeded: { min: 2, max: 10 },
                slot: {
                    timeSlotDocId: 'tsDoc123',
                    slotId: 'slot123',
                    price: 500
                },
                sport: 'cricket'
            };

            const mockSlot = {
                _id: 'slot123',
                status: 'available',
                startTime: new Date(),
                endTime: new Date()
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);
            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            // Atomic lock fails
            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

            await startGameBooking(req as Request, res as Response, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            const error = (next as jest.Mock).mock.calls[0][0];
            expect(error.message).toBe('Slot is no longer available');
            expect(error.statusCode).toBe(400);
        });
    });

    describe('Error Handling: Stripe Session Creation Fails', () => {
        it('should rollback slot lock when Stripe fails', async () => {
            const mockGame = {
                _id: new mongoose.Types.ObjectId(),
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2', 'player3'],
                playersNeeded: { min: 2, max: 10 },
                slot: {
                    timeSlotDocId: 'tsDoc123',
                    slotId: 'slot123',
                    price: 500,
                    startTime: new Date(),
                    endTime: new Date()
                },
                sport: 'cricket',
                venue: {
                    venueId: 'venue123',
                    coordinates: { coordinates: [0, 0] }
                },
                subVenue: {
                    subVenueId: 'subvenue123'
                }
            };

            const mockSlot = {
                _id: 'slot123',
                status: 'available',
                startTime: new Date(),
                endTime: new Date()
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);
            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: [mockSlot]
            });

            (TimeSlot.updateOne as jest.Mock).mockResolvedValue({ acknowledged: true });

            // Stripe fails
            mockSessionCreate.mockRejectedValue(new Error('Stripe API error'));

            await startGameBooking(req as Request, res as Response, next);

            // Verify rollback was called with updateOne
            expect(TimeSlot.updateOne).toHaveBeenCalledWith(
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

    describe('Error Handling: Booking Creation Fails', () => {
        it('should rollback slot lock when Booking.create fails', async () => {
            const mockGame = {
                _id: new mongoose.Types.ObjectId(),
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2', 'player3'],
                playersNeeded: { min: 2, max: 10 },
                slot: {
                    timeSlotDocId: 'tsDoc123',
                    slotId: 'slot123',
                    price: 500,
                    startTime: new Date(),
                    endTime: new Date()
                },
                sport: 'cricket',
                venue: {
                    venueId: 'venue123',
                    coordinates: { coordinates: [0, 0] }
                },
                subVenue: {
                    subVenueId: 'subvenue123'
                }
            };

            const mockSlot = {
                _id: 'slot123',
                status: 'available',
                startTime: new Date(),
                endTime: new Date()
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);
            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: [mockSlot]
            });

            (TimeSlot.updateOne as jest.Mock).mockResolvedValue({ acknowledged: true });

            mockSessionCreate.mockResolvedValue({
                id: 'sess_123',
                url: 'http://stripe.com/pay'
            });

            // Booking.create fails
            (Booking.create as jest.Mock).mockRejectedValue(new Error('Database error'));

            await startGameBooking(req as Request, res as Response, next);

            // Verify rollback was called with updateOne
            expect(TimeSlot.updateOne).toHaveBeenCalledWith(
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

    describe('Success: Game Status Updated to Full', () => {
        it('should create booking successfully with Stripe checkout URL', async () => {
            const mockGameSave = jest.fn().mockResolvedValue(true);
            const mockGame = {
                _id: new mongoose.Types.ObjectId(),
                host: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
                status: 'Open',
                bookingStatus: 'NotBooked',
                approvedPlayers: ['player1', 'player2', 'player3'],
                playersNeeded: { min: 2, max: 10 },
                slot: {
                    timeSlotDocId: 'tsDoc123',
                    slotId: 'slot123',
                    price: 500,
                    startTime: new Date(),
                    endTime: new Date()
                },
                sport: 'cricket',
                venue: {
                    venueId: 'venue123',
                    coordinates: { coordinates: [0, 0] }
                },
                subVenue: {
                    subVenueId: 'subvenue123'
                },
                save: mockGameSave
            };

            const mockSlot = {
                _id: 'slot123',
                status: 'available',
                startTime: new Date(),
                endTime: new Date()
            };

            (Game.findById as jest.Mock).mockResolvedValue(mockGame);
            (TimeSlot.findById as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: {
                    id: jest.fn().mockReturnValue(mockSlot)
                }
            });

            (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
                _id: 'tsDoc123',
                slots: [mockSlot]
            });

            mockSessionCreate.mockResolvedValue({
                id: 'sess_123',
                url: 'http://stripe.com/pay'
            });

            (Booking.create as jest.Mock).mockResolvedValue({
                _id: 'booking123',
                status: 'Pending'
            });

            await startGameBooking(req as Request, res as Response, next);

            // Game status should NOT be updated in normal mode (only in demo mode)
            expect(mockGame.status).toBe('Open');
            expect(mockGameSave).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                url: 'http://stripe.com/pay',
                bookingId: 'booking123'
            }));
        });
    });
});
