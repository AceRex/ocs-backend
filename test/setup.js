const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

jest.setTimeout(120000);

let mongoServer;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_jwt_secret_key_1234567890_test_env';
  process.env.GRACE_PERIOD_MONTHS = '3';
  process.env.FRONTEND_URL = 'https://churchocs.com';

  mongoServer = await MongoMemoryServer.create({
    instance: {
      launchTimeout: 30000,
    },
  });
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  const { connectToDatabase } = require('../src/config/db');
  await connectToDatabase(uri);
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
  const { loginAttemptTracker } = require('../src/middleware/rateLimiter');
  loginAttemptTracker.clearAll();
});

afterAll(async () => {
  const { disconnectDatabase } = require('../src/config/db');
  await disconnectDatabase();
  if (mongoServer) {
    await mongoServer.stop();
  }
});
