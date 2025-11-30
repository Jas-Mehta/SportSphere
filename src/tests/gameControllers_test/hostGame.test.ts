import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { hostGame, cancelGame, leaveGame } from '../../controllers/gameControllers/hostGame';
import Game from '../../models/gameModels';
import Venue from '../../models/Venue';
import SubVenue from '../../models/SubVenue';
import AppError from '../../utils/AppError';
import { IUserRequest } from '../../middleware/authMiddleware';
import { slotAvailabilityCheck } from '../../utils/slotAvailabilityCheck';
import { checkNoTimeOverlapForUser } from '../../utils/checkNoTimeOverlapForUser';

// Mock the models and utilities
jest.mock('../../models/gameModels');
jest.mock('../../models/Venue');
jest.mock('../../models/SubVenue');
jest.mock('../../utils/slotAvailabilityCheck');
jest.mock('../../utils/checkNoTimeOverlapForUser');

describe('Game Controllers - hostGame.ts', () => {
  let mockRequest: Partial<IUserRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();

    mockResponse = {
      json: jsonMock,
      status: jest.fn(function(this: any) {
        return this;
      }),
    };

    statusMock = mockResponse.status as jest.Mock;

    mockRequest = {
      params: {},
      body: {},
      user: {
        _id: 'user123',
        username: 'testuser',
        email: 'test@example.com',
        role: 'player',
      } as any,
    };

    mockNext = jest.fn();

    jest.clearAllMocks();
  });

  describe('hostGame', () => {
    const mockVenue = {
      _id: 'venue123',
      city: 'Mumbai',
      state: 'Maharashtra',
      location: {
        coordinates: [72.8777, 19.0760],
      },
    };

    const mockSubVenue = {
      _id: 'subvenue123',
      name: 'Court A',
      sports: [
        { name: 'football', available: true },
        { name: 'cricket', available: true },
      ],
    };

    const mockSlot = {
      _id: 'slot123',
      startTime: new Date('2025-12-01T10:00:00Z'),
      endTime: new Date('2025-12-01T12:00:00Z'),
      prices: new Map([
        ['football', 1000],
        ['cricket', 800],
      ]),
    };

    const validRequestBody = {
      sport: 'football',
      venueId: 'venue123',
      subVenueId: 'subvenue123',
      timeSlotDocId: 'timeslot123',
      slotId: 'slot123',
      description: 'Friendly football match',
      playersNeeded: { min: 5, max: 10 },
    };

    beforeEach(() => {
      (Venue.findById as jest.Mock) = jest.fn().mockResolvedValue(mockVenue);
      (SubVenue.findById as jest.Mock) = jest.fn().mockResolvedValue(mockSubVenue);
      (slotAvailabilityCheck as jest.Mock) = jest.fn().mockResolvedValue(mockSlot);
      (checkNoTimeOverlapForUser as jest.Mock) = jest.fn().mockResolvedValue(undefined);
      (Game.create as jest.Mock) = jest.fn().mockResolvedValue({
        _id: 'game123',
        host: 'user123',
        sport: 'football',
        status: 'Open',
      });
    });

    it('should successfully host a game with valid inputs', async () => {
      mockRequest.body = validRequestBody;

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(Venue.findById).toHaveBeenCalledWith('venue123');
      expect(SubVenue.findById).toHaveBeenCalledWith('subvenue123');
      expect(slotAvailabilityCheck).toHaveBeenCalledWith('timeslot123', 'slot123', 'football');
      expect(checkNoTimeOverlapForUser).toHaveBeenCalledWith(
        'user123',
        mockSlot.startTime,
        mockSlot.endTime
      );
      expect(Game.create).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'user123',
          sport: 'football',
          status: 'Open',
          approvedPlayers: ['user123'],
          joinRequests: [],
        })
      );
      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Game hosted successfully',
        game: expect.any(Object),
      });
    });

    it('should throw error when sport field is missing', async () => {
      mockRequest.body = { ...validRequestBody, sport: undefined };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Missing required fields');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when venueId field is missing', async () => {
      mockRequest.body = { ...validRequestBody, venueId: undefined };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Missing required fields');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when subVenueId field is missing', async () => {
      mockRequest.body = { ...validRequestBody, subVenueId: undefined };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Missing required fields');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when timeSlotDocId field is missing', async () => {
      mockRequest.body = { ...validRequestBody, timeSlotDocId: undefined };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Missing required fields');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when slotId field is missing', async () => {
      mockRequest.body = { ...validRequestBody, slotId: undefined };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Missing required fields');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when playersNeeded is missing', async () => {
      mockRequest.body = { ...validRequestBody, playersNeeded: undefined };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('playersNeeded (min/max) are required');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when playersNeeded.min is missing', async () => {
      mockRequest.body = { ...validRequestBody, playersNeeded: { max: 10 } };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('playersNeeded (min/max) are required');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when playersNeeded.max is missing', async () => {
      mockRequest.body = { ...validRequestBody, playersNeeded: { min: 5 } };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('playersNeeded (min/max) are required');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when min players exceeds max players', async () => {
      mockRequest.body = { ...validRequestBody, playersNeeded: { min: 15, max: 10 } };

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('min players cannot exceed max players');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when venue is not found', async () => {
      (Venue.findById as jest.Mock) = jest.fn().mockResolvedValue(null);
      mockRequest.body = validRequestBody;

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Venue not found');
      expect(errorArg.statusCode).toBe(404);
    });

    it('should throw error when subVenue is not found', async () => {
      (SubVenue.findById as jest.Mock) = jest.fn().mockResolvedValue(null);
      mockRequest.body = validRequestBody;

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('SubVenue not found');
      expect(errorArg.statusCode).toBe(404);
    });

    it('should throw error when sport is not available in subVenue', async () => {
      const mockSubVenueNoFootball = {
        ...mockSubVenue,
        sports: [{ name: 'cricket', available: true }],
      };
      (SubVenue.findById as jest.Mock) = jest.fn().mockResolvedValue(mockSubVenueNoFootball);
      mockRequest.body = validRequestBody;

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('This sport is not available on this subVenue');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when slot does not have valid price for sport', async () => {
      const mockSlotNoPrice = {
        ...mockSlot,
        prices: new Map([['cricket', 800]]),
      };
      (slotAvailabilityCheck as jest.Mock) = jest.fn().mockResolvedValue(mockSlotNoPrice);
      mockRequest.body = validRequestBody;

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Slot does not have a valid price for this sport');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should handle slot prices as object instead of Map', async () => {
      const mockPrices: any = {
        football: 1000,
        cricket: 800,
        get: function (sport: string): number | undefined {
          return this[sport];
        }
      };

      const mockSlotWithObject = {
        _id: 'slot123',
        startTime: new Date('2025-12-01T10:00:00Z'),
        endTime: new Date('2025-12-01T12:00:00Z'),
        prices: mockPrices,
      };
      
      (slotAvailabilityCheck as jest.Mock) = jest.fn().mockResolvedValue(mockSlotWithObject);
      mockRequest.body = validRequestBody;

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(Game.create).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(201);
    });

    it('should calculate approxCostPerPlayer correctly', async () => {
      mockRequest.body = validRequestBody;

      await hostGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(Game.create).toHaveBeenCalledWith(
        expect.objectContaining({
          approxCostPerPlayer: 100, // 1000 / 10
        })
      );
    });
  });

  describe('cancelGame', () => {
    const mockGame = {
      _id: 'game123',
      host: 'user123',
      bookingStatus: 'NotBooked',
      slot: {
        startTime: new Date(Date.now() + 5 * 60 * 60 * 1000), // 5 hours from now
      },
      status: 'Open',
      save: jest.fn().mockResolvedValue(true),
    };

    beforeEach(() => {
      mockRequest.params = { gameId: 'game123' };
      (Game.findById as jest.Mock) = jest.fn().mockResolvedValue(mockGame);
      mockGame.save.mockClear();
    });

    it('should successfully cancel a game when conditions are met', async () => {
      await cancelGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(Game.findById).toHaveBeenCalledWith('game123');
      expect(mockGame.status).toBe('Cancelled');
      expect(mockGame.save).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Game cancelled successfully',
      });
    });

    it('should throw error when game is not found', async () => {
      (Game.findById as jest.Mock) = jest.fn().mockResolvedValue(null);

      await cancelGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Game not found');
      expect(errorArg.statusCode).toBe(404);
    });

    it('should throw error when non-host tries to cancel', async () => {
      mockRequest.user = {
        _id: 'differentUser',
        username: 'otheruser',
        email: 'other@example.com',
        role: 'player',
      } as any;

      await cancelGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Only the host can cancel this game');
      expect(errorArg.statusCode).toBe(403);
    });

    it('should throw error when trying to cancel booked game', async () => {
      const bookedGame = { ...mockGame, bookingStatus: 'Booked' };
      (Game.findById as jest.Mock) = jest.fn().mockResolvedValue(bookedGame);

      await cancelGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Cannot cancel a game after the slot is booked.');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when trying to cancel less than 2 hours before start', async () => {
      const soonGame = {
        ...mockGame,
        slot: {
          startTime: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour from now
        },
      };
      (Game.findById as jest.Mock) = jest.fn().mockResolvedValue(soonGame);

      await cancelGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Games can only be cancelled at least 2 hours in advance');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should allow cancellation exactly 2 hours before start', async () => {
      const exactlyTwoHours = {
        ...mockGame,
        slot: {
          startTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // exactly 2 hours
        },
      };
      (Game.findById as jest.Mock) = jest.fn().mockResolvedValue(exactlyTwoHours);

      await cancelGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockGame.save).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Game cancelled successfully',
      });
    });
  });

  describe('leaveGame', () => {
    let mockSession: any;
    let mockGame: any;

    beforeEach(() => {
      mockSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        abortTransaction: jest.fn(),
        endSession: jest.fn(),
      };

      (mongoose.startSession as jest.Mock) = jest.fn().mockResolvedValue(mockSession);

      mockGame = {
        _id: 'game123',
        host: 'host123',
        approvedPlayers: ['host123', 'user123', 'user456'],
        joinRequests: [{ user: "user123" }, { user: "user777" }],
        bookingStatus: 'NotBooked',
        status: 'Open',
        playersNeeded: { min: 5, max: 10 },
        save: jest.fn().mockResolvedValue(true),
      };

      mockRequest.params = { gameId: 'game123' };
      (Game.findById as jest.Mock) = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(mockGame),
      });
    });

    it('should successfully leave a game when user is approved', async () => {
      await leaveGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mongoose.startSession).toHaveBeenCalled();
      expect(mockSession.startTransaction).toHaveBeenCalled();
      expect(mockGame.approvedPlayers).toEqual(['host123', 'user456']);
      expect(mockGame.joinRequests).toEqual([{ user: "user777" }]);
      expect(mockGame.save).toHaveBeenCalledWith({ session: mockSession });
      expect(mockSession.commitTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'You have left the game',
        status: mockGame.status,
      });
    });

    it('should throw error when game is not found', async () => {
      (Game.findById as jest.Mock) = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      await leaveGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Game not found');
      expect(errorArg.statusCode).toBe(404);
    });

    it('should throw error when slot is already booked', async () => {
      mockGame.bookingStatus = 'Booked';

      await leaveGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('Cannot leave the game because slot is already booked');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should throw error when user is not approved for the game', async () => {
      mockGame.approvedPlayers = ['host123', 'user456'];

      await leaveGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      const errorArg = (mockNext as jest.Mock).mock.calls[0][0];
      expect(errorArg).toBeInstanceOf(AppError);
      expect(errorArg.message).toBe('You are not approved for this game');
      expect(errorArg.statusCode).toBe(400);
    });

    it('should reopen game when status was Full and becomes not full', async () => {
      mockGame.status = 'Full';
      mockGame.approvedPlayers = ['host123', 'user123', 'user456', 'user789', 'user012',
        'user234', 'user567', 'user890', 'user111', 'user222'];
      mockGame.playersNeeded = { min: 5, max: 10 };

      await leaveGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockGame.status).toBe('Open');
      expect(mockGame.approvedPlayers.length).toBe(9);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it('should not change status if game was not Full', async () => {
      mockGame.status = 'Open';
      mockGame.approvedPlayers = ['host123', 'user123', 'user456'];

      await leaveGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockGame.status).toBe('Open');
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it('should abort transaction and end session on error', async () => {
      mockGame.save.mockRejectedValue(new Error('Database error'));

      await leaveGame(
        mockRequest as IUserRequest,
        mockResponse as Response,
        mockNext
      );

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });
});