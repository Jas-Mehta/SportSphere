import mongoose from "mongoose";
import { Request, Response } from "express";
import { MongoMemoryServer } from "mongodb-memory-server";
import Venue from "../../models/Venue";
import SubVenue from "../../models/SubVenue";
import {
  createVenue,
  getVenues,
  getVenueById,
  updateVenue,
  deleteVenue,
  createSubVenue,
  rateVenue,
  getVenueRatings
} from "../../controllers/venueController";

// Jest timeout 
jest.setTimeout(20000);

// Mocking cloudinary 
jest.mock("../../config/cloudinary", () => ({
  uploader: {
    upload: jest.fn().mockResolvedValue({ secure_url: "http://mock-image.com" })
  }
}));


jest.mock("fs", () => {
  const actualFs = jest.requireActual("fs");
  return {
    ...actualFs,
    unlinkSync: jest.fn()
  };
});

let mongoServer: MongoMemoryServer;

describe("Venue & SubVenue Controller", () => {

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterEach(async () => {
    // Keep DB clean between tests to avoid weird side-effects
    await Venue.deleteMany({});
    await SubVenue.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  const mockUserId = new mongoose.Types.ObjectId();

  // Helper function test
  const mockReq = (body: any = {}, params: any = {}, user: any = null): any => ({
    body,
    params,
    user,
    files: []
  });


  const mockRes = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
  };

  // controller tests

  it("creates a venue when valid data and user are provided", async () => {
    const req = mockReq(
      {
        name: "Test Venue",
        address: "123 Street",
        city: "Pune",
        location: { coordinates: [72.8777, 19.0760] }
      },
      {},
      { _id: mockUserId }
    );

    const res = mockRes();
    await createVenue(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 401 if trying to create venue without logged-in user", async () => {
    const req = mockReq({
      name: "No Auth Venue",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] }
    });

    const res = mockRes();
    await createVenue(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("fetches all venues successfully", async () => {
    await Venue.create({
      name: "Venue 1",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] },
      owner: mockUserId
    });

    const req = mockReq();
    const res = mockRes();

    await getVenues(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("fetches a venue by valid ID", async () => {
    const venue = await Venue.create({
      name: "Venue X",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] },
      owner: mockUserId
    });

    const req = mockReq({}, { id: venue._id });
    const res = mockRes();

    await getVenueById(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 404 if venue does not exist", async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const req = mockReq({}, { id: fakeId });
    const res = mockRes();

    await getVenueById(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("updates venue details correctly", async () => {
    const venue = await Venue.create({
      name: "Old Name",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] },
      owner: mockUserId
    });

    const req = mockReq({ name: "New Name" }, { id: venue._id });
    const res = mockRes();

    await updateVenue(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 404 when trying to update non-existing venue", async () => {
    const req = mockReq({ name: "Ghost" }, { id: new mongoose.Types.ObjectId() });
    const res = mockRes();

    await updateVenue(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("deletes venue and its subvenues", async () => {
    const venue = await Venue.create({
      name: "Delete Venue",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] },
      owner: mockUserId
    });

    await SubVenue.create({
      venue: venue._id,
      name: "Court 1",
      sports: [{ name: "cricket", minPlayers: 2, maxPlayers: 10 }]
    });

    const req = mockReq({}, { id: venue._id });
    const res = mockRes();

    await deleteVenue(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 404 when deleting non-existing venue", async () => {
    const req = mockReq({}, { id: new mongoose.Types.ObjectId() });
    const res = mockRes();

    await deleteVenue(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // subvenue tests

  it("creates subvenue and updates venue sports list", async () => {
    const venue = await Venue.create({
      name: "Venue Main",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] },
      owner: mockUserId
    });

    const req = mockReq({
      venue: venue._id,
      name: "Court",
      sports: [{ name: "football", minPlayers: 2, maxPlayers: 10 }]
    });

    const res = mockRes();
    await createSubVenue(req, res);

    const updatedVenue = await Venue.findById(venue._id);
    expect(updatedVenue?.sports).toContain("football");
  });

  // Rate venue edge case

  it("rates a venue with valid rating", async () => {
    const venue = await Venue.create({
      name: "Rated Venue",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] },
      owner: mockUserId
    });

    const req = mockReq({ userId: mockUserId.toString(), rating: 5 }, { id: venue._id });
    const res = mockRes();

    await rateVenue(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects rating above allowed range", async () => {
    const venue = await Venue.create({
      name: "Bad Rating Venue",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] },
      owner: mockUserId
    });

    const req = mockReq({ userId: mockUserId.toString(), rating: 10 }, { id: venue._id });
    const res = mockRes();

    await rateVenue(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns venue ratings data correctly", async () => {
    const venue = await Venue.create({
      name: "Rated Venue",
      address: "Addr",
      city: "City",
      location: { coordinates: [1, 2] },
      owner: mockUserId
    });

    const req = mockReq({}, { id: venue._id });
    const res = mockRes();

    await getVenueRatings(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});