const serverless = require("serverless-http");
const app = require("../../src/app");
const { connectToDatabase } = require("../../src/config/db");

// Wrap the Express app with serverless-http
const serverlessHandler = serverless(app);

/**
 * Netlify Function handler.
 * Reuses the MongoDB connection across warm invocations outside the handler.
 */
exports.handler = async (event, context) => {
  // Prevent AWS Lambda / Netlify from waiting for the Node event loop to empty
  context.callbackWaitsForEmptyEventLoop = false;

  const origin = event.headers?.origin || event.headers?.Origin || "*";

  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
  };

  // Immediate preflight response for OPTIONS requests
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: "",
    };
  }

  try {
    // Ensure DB connection is established/reused before processing the request
    await connectToDatabase();
  } catch (err) {
    console.error("Failed to establish database connection in serverless function:", err);
    return {
      statusCode: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "database_error",
        message: "Unable to connect to database",
      }),
    };
  }

  const response = await serverlessHandler(event, context);

  // Ensure CORS headers are merged into the final response
  return {
    ...response,
    headers: {
      ...corsHeaders,
      ...(response.headers || {}),
    },
  };
};
