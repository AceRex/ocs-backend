const app = require('./app');
const env = require('./config/env');
const { connectToDatabase } = require('./config/db');

async function startServer() {
  try {
    console.log(`Connecting to MongoDB...`);
    await connectToDatabase();
    console.log(`MongoDB connected successfully.`);

    const server = app.listen(env.PORT, () => {
      console.log(`OCS Backend Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
    });

    // Graceful shutdown handling
    const shutdown = async () => {
      console.log('Shutting down OCS backend gracefully...');
      server.close(async () => {
        const { disconnectDatabase } = require('./config/db');
        await disconnectDatabase();
        console.log('Server stopped.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    return server;
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[Port Conflict] Port ${env.PORT} is already in use by another process (e.g. macOS AirPlay).`);
      console.error(`Try setting PORT=5001 or another port in your .env file:\n  PORT=5001\n`);
    } else {
      console.error('Failed to start OCS Backend server:', err);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
