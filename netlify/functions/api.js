const serverless = require('serverless-http');
const app = require('../../src/app');
const { connectToDatabase } = require('../../src/config/db');

// Wrap the Express app with serverless-http
const serverlessHandler = serverless(app);

/**
 * Netlify Function handler.
 * Reuses the MongoDB connection across warm invocations outside the handler.
 */
exports.handler = async (event, context) => {
  // Prevent AWS Lambda / Netlify from waiting for the Node event loop to empty
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    // Ensure DB connection is established/reused before processing the request
    await connectToDatabase();
  } catch (err) {
    console.error('Failed to establish database connection in serverless function:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'database_error',
        message: 'Unable to connect to database',
      }),
    };
  }

  return serverlessHandler(event, context);
};
