import { Request, Response, NextFunction } from 'express';
import { startGameBooking } from '../../controllers/Booking/gameBooking';
import TimeSlot from '../../models/TimeSlot';
import Booking from '../../models/Booking';
import Game from '../../models/gameModels';
import AppError from '../../utils/AppError';

// Mock dependencies
jest.mock('../../models/TimeSlot');
jest.mock('../../models/Booking');
jest.mock('../../models/gameModels');
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
    const mockCreate = jest.fn();
    const MockStripe = jest.fn(() => ({
        checkout: {
            sessions: {
                create: mockCreate,
            },
        },
    }));
    (MockStripe as any).mockCreate = mockCreate;
    return MockStripe;
});

// Access the mock function
// We need to instantiate it to get the mock function
const Stripe = require('stripe');
// Since the mock returns a constructor that returns an object with checkout.sessions.create
// We can't easily grab the *same* jest.fn() instance unless we expose it.
// Better approach:
// Use a global variable or just rely on the fact that we can get it from the module if we structured it differently.
// Let's try the 'require' approach inside the test or beforeEach.


describe('startGameBooking Controller', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;

    let mockStripeSessionCreate: jest.Mock;

    beforeEach(() => {
        process.env.STRIPE_SECRET_KEY = 'test_secret';

        // Reset mocks
        jest.clearAllMocks();

        // Get the stable mock function
        mockStripeSessionCreate = (require('stripe') as any).mockCreate;
        mockStripeSessionCreate.mockReset(); // Reset state

        req = {
            params: { gameId: 'game123' },
            user: { _id: 'host123' }
        } as unknown as Request;

        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        } as Partial<Response>;

        next = jest.fn();
    });

    it('should successfully book a game with atomic locking', async () => {
        // Mock Game
        const mockGame = {
            _id: 'game123',
            host: 'host123',
            status: 'Open',
            playersNeeded: { min: 2 },
            approvedPlayers: ['p1', 'p2'],
            sport: 'Football',
            slot: {
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                price: 500,
                startTime: new Date(),
                endTime: new Date()
            },
            venue: {
                venueId: 'venue123',
                coordinates: { coordinates: [0, 0] }
            },
            subVenue: {
                subVenueId: 'subVenue123'
            },
            save: jest.fn().mockResolvedValue(true)
        };
        (Game.findById as jest.Mock).mockResolvedValue(mockGame);

        // Mock TimeSlot Find (Validation)
        (TimeSlot.findById as jest.Mock).mockResolvedValue({
            _id: 'tsDoc123',
            slots: {
                id: jest.fn().mockReturnValue({ status: 'available' })
            }
        });

        // Mock Atomic Lock
        (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
            _id: 'tsDoc123',
            slots: [{ _id: 'slot123', status: 'booked' }]
        });

        // Mock Stripe
        mockStripeSessionCreate.mockResolvedValue({
            id: 'sess_game',
            url: 'http://stripe.com/game'
        });

        // Mock Booking
        (Booking.create as jest.Mock).mockResolvedValue({
            _id: 'bookingGame',
            status: 'Pending'
        });

        await startGameBooking(req as Request, res as Response, next);

        // Verify Atomic Lock
        expect(TimeSlot.findOneAndUpdate).toHaveBeenCalledWith(
            {
                _id: 'tsDoc123',
                "slots._id": 'slot123',
                "slots.status": "available"
            },
            expect.any(Object),
            { new: true }
        );

        // Verify Metadata
        expect(mockStripeSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                type: "game",
                gameId: "game123",
                slotId: "slot123"
            })
        }));

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            url: 'http://stripe.com/game'
        }));
    });

    it('should rollback lock if Stripe fails', async () => {
        // Mock Game
        const mockGame = {
            _id: 'game123',
            host: 'host123',
            status: 'Open',
            playersNeeded: { min: 2 },
            approvedPlayers: ['p1', 'p2'],
            sport: 'Football',
            slot: {
                timeSlotDocId: 'tsDoc123',
                slotId: 'slot123',
                price: 500,
                startTime: new Date(),
                endTime: new Date()
            },
            venue: {
                venueId: 'venue123',
                coordinates: { coordinates: [0, 0] }
            },
            subVenue: {
                subVenueId: 'subVenue123'
            },
            save: jest.fn().mockResolvedValue(true)
        };
        (Game.findById as jest.Mock).mockResolvedValue(mockGame);

        (TimeSlot.findById as jest.Mock).mockResolvedValue({
            _id: 'tsDoc123',
            slots: {
                id: jest.fn().mockReturnValue({ status: 'available' })
            }
        });

        // Mock Successful Lock
        (TimeSlot.findOneAndUpdate as jest.Mock).mockResolvedValue({
            _id: 'tsDoc123',
            slots: [{ _id: 'slot123', status: 'booked' }]
        });

        // Mock updateOne for rollback
        (TimeSlot.updateOne as jest.Mock) = jest.fn().mockResolvedValue({ modifiedCount: 1 });

        // Mock Stripe Failure
        mockStripeSessionCreate.mockRejectedValue(new Error('Stripe Fail'));

        try {
            await startGameBooking(req as Request, res as Response, next);
        } catch (e) { }

        // Verify Rollback using updateOne
        expect(TimeSlot.updateOne).toHaveBeenCalledWith(
            { _id: 'tsDoc123', "slots._id": 'slot123' },
            expect.objectContaining({
                $set: expect.objectContaining({
                    "slots.$.status": "available",
                    "slots.$.bookedForSport": null
                })
            })
        );
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
});
