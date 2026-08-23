/**
 * Migration script to normalize trialEndsAt and graceExpiresAt to exactly 60 days
 * for all trial users in the database.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectToDatabase } = require('../src/config/db');
const User = require('../src/models/User');

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

async function run() {
  await connectToDatabase();
  console.log('[Migration] Connected to MongoDB. Normalizing trial dates...');

  const trialUsers = await User.find({ subscriptionTier: 'trial' });
  console.log(`[Migration] Found ${trialUsers.length} trial user(s).`);

  let updatedCount = 0;
  for (const user of trialUsers) {
    const trialStart = user.trialStartedAt || user.createdAt || new Date();
    const correctTrialEnd = new Date(new Date(trialStart).getTime() + SIXTY_DAYS_MS);

    user.trialEndsAt = correctTrialEnd;
    user.graceExpiresAt = correctTrialEnd;
    await user.save();
    updatedCount++;

    const remaining = user.getTrialRemainingDays();
    console.log(`[Migration] Updated user: ${user.email} -> trialEndsAt: ${correctTrialEnd.toISOString()} | remainingDays: ${remaining}`);
  }

  console.log(`[Migration] Successfully normalized ${updatedCount} trial user(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[Migration Error]:', err);
  process.exit(1);
});
