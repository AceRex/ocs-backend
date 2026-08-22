/**
 * Real HTTP End-to-End Verification Script for OCS Backend.
 * Spawns the real Express server on an ephemeral port, executes real HTTP requests
 * using Node's native fetch, and asserts exact behavior on every endpoint and edge-case.
 */

const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const User = require('../src/models/User');
const Testimonial = require('../src/models/Testimonial');
const { connectToDatabase, disconnectDatabase } = require('../src/config/db');

let server;
let baseUrl;
let mongoServer;

const results = [];

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    results.push({ name: testName, status: 'PASS', details });
  } else {
    console.error(`  [FAIL] ${testName}: ${details}`);
    results.push({ name: testName, status: 'FAIL', details });
  }
}

async function run() {
  console.log('\n========================================');
  console.log('OCS Backend Real HTTP Request Verification');
  console.log('========================================\n');

  // 1. Setup in-memory MongoDB
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'super_secret_verification_key_12345';
  process.env.GRACE_PERIOD_MONTHS = '3';
  process.env.FRONTEND_URL = 'https://churchocs.com';

  mongoServer = await MongoMemoryServer.create({
    instance: {
      launchTimeout: 30000,
    },
  });
  const mongoUri = mongoServer.getUri();
  await connectToDatabase(mongoUri);

  // 2. Start HTTP server
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Server listening on ${baseUrl}\n`);

  try {
    // --- 1. HEALTH CHECK ---
    console.log('--- 1. Health Check ---');
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthJson = await healthRes.json();
    assert(healthRes.status === 200 && healthJson.status === 'ok', 'GET /health returns 200 OK');

    // --- 2. SIGNUP ---
    console.log('\n--- 2. Auth: POST /api/auth/signup ---');
    const userPayload = {
      email: 'pastor.john@gracechurch.org',
      password: 'StrongPassword123!',
      churchName: 'Grace Community Church',
    };

    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userPayload),
    });
    const signupJson = await signupRes.json();
    if (signupRes.status !== 201) {
      console.error('Signup error response:', signupRes.status, signupJson);
    }

    assert(signupRes.status === 201, 'Signup returns HTTP 201 Created', `Status was ${signupRes.status}`);
    assert(!!signupJson.token, 'Signup returns JWT token');
    assert(signupJson.user && signupJson.user.email === userPayload.email.toLowerCase(), 'Signup returns sanitized user');
    assert(signupJson.user && !signupJson.user.passwordHash, 'Signup response never contains passwordHash');
    assert(signupJson.user && !!signupJson.user.graceExpiresAt, 'Signup computes 3-month graceExpiresAt');

    const userToken = signupJson.token;
    const userId = signupJson.user.id;

    // Test duplicate signup rejection
    const duplicateRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userPayload),
    });
    const duplicateJson = await duplicateRes.json();
    assert(duplicateRes.status === 409 && duplicateJson.error === 'email_exists', 'Duplicate signup rejected with 409 email_exists');

    // --- 3. LOGIN ---
    console.log('\n--- 3. Auth: POST /api/auth/login ---');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userPayload.email,
        password: userPayload.password,
      }),
    });
    const loginJson = await loginRes.json();
    assert(loginRes.status === 200 && !!loginJson.token, 'Valid login returns HTTP 200 + token');

    // Test invalid password
    const wrongPassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userPayload.email,
        password: 'WrongPassword!',
      }),
    });
    const wrongPassJson = await wrongPassRes.json();
    assert(wrongPassRes.status === 401 && wrongPassJson.error === 'invalid_credentials', 'Invalid password rejected with 401 invalid_credentials');

    // --- 4. VALIDATE-TOKEN & ME ---
    console.log('\n--- 4. Auth: POST /api/auth/validate-token & GET /api/auth/me ---');
    const validateRes = await fetch(`${baseUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken }),
    });
    const validateJson = await validateRes.json();
    assert(validateRes.status === 200 && validateJson.valid === true, 'validate-token returns valid: true for active session');

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const meJson = await meRes.json();
    assert(meRes.status === 200 && meJson.user.email === userPayload.email.toLowerCase(), 'GET /auth/me returns current user profile');

    // --- 5. REVOCATION (LOGOUT) ---
    console.log('\n--- 5. Auth: POST /api/auth/revoke ---');
    const revokeRes = await fetch(`${baseUrl}/api/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken }),
    });
    const revokeJson = await revokeRes.json();
    assert(revokeRes.status === 200 && revokeJson.success === true, 'POST /auth/revoke succeeds');

    // Token should now be invalid on subsequent validate-token call
    const postRevokeValidateRes = await fetch(`${baseUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: userToken }),
    });
    const postRevokeValidateJson = await postRevokeValidateRes.json();
    assert(postRevokeValidateJson.valid === false && postRevokeValidateJson.reason === 'token_revoked', 'validate-token rejects revoked token with reason: token_revoked');

    // --- 6. 3-MONTH TRIAL EXPIRATION GATING ---
    console.log('\n--- 6. Trial Expiration Gating ---');
    // Create an expired test account directly in DB
    const expiredUser = await User.create({
      email: 'expired@church.org',
      passwordHash: signupJson.user ? await require('bcryptjs').hash('Pass12345!', 10) : '',
      churchName: 'Old Church',
      role: 'user',
      graceExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day expired
    });

    const expiredLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'expired@church.org', password: 'Pass12345!' }),
    });
    const expiredLoginJson = await expiredLoginRes.json();
    assert(expiredLoginRes.status === 403 && expiredLoginJson.error === 'trial_expired', 'Expired trial blocks login with HTTP 403 trial_expired');

    // --- 7. CREATE ADMIN & TEST RBAC ---
    console.log('\n--- 7. Admin RBAC & Authorization Guard ---');
    const adminUser = await User.create({
      email: 'admin@churchocs.com',
      passwordHash: await require('bcryptjs').hash('AdminPass123!', 10),
      churchName: 'OCS Master Admin',
      role: 'admin',
      graceExpiresAt: User.computeGraceExpiry(12),
    });

    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@churchocs.com', password: 'AdminPass123!' }),
    });
    const adminToken = (await adminLoginRes.json()).token;

    // Issue a fresh non-admin token for non-admin user
    const regularUser = await User.create({
      email: 'regular@church.org',
      passwordHash: await require('bcryptjs').hash('Regular123!', 10),
      churchName: 'Regular Church',
      role: 'user',
      graceExpiresAt: User.computeGraceExpiry(3),
    });
    const regularLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@church.org', password: 'Regular123!' }),
    });
    const regularToken = (await regularLoginRes.json()).token;

    // Try accessing /admin/downloads with regular token -> MUST 403
    const forbiddenRes = await fetch(`${baseUrl}/api/admin/downloads`, {
      headers: { Authorization: `Bearer ${regularToken}` },
    });
    const forbiddenJson = await forbiddenRes.json();
    assert(forbiddenRes.status === 403 && forbiddenJson.error === 'forbidden', 'Regular user token rejected from /admin/* with 403 forbidden');

    // Access /admin/downloads with admin token -> MUST 200
    const adminAccessRes = await fetch(`${baseUrl}/api/admin/downloads`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminAccessRes.status === 200, 'Admin token successfully accesses /admin/downloads with 200');

    // --- 8. DOWNLOAD TRACKING ---
    console.log('\n--- 8. Downloads Tracking ---');
    const dlRes = await fetch(`${baseUrl}/api/downloads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'macos',
        appVersion: '1.4.2',
        churchName: 'Grace Church',
      }),
    });
    const dlJson = await dlRes.json();
    assert(dlRes.status === 201 && dlJson.success === true, 'Anonymous download logged with 201');

    // --- 9. TESTIMONIALS MODERATION & STRICT FILTERING ---
    console.log('\n--- 9. Testimonials & Strict Public Filtering ---');
    const submitTestimonialRes = await fetch(`${baseUrl}/api/testimonials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Pastor Michael',
        churchName: 'Hope Chapel',
        message: 'Amazing multi-screen presentation software!',
        rating: 5,
      }),
    });
    const submitTestimonialJson = await submitTestimonialRes.json();
    const testimonialId = submitTestimonialJson.id;
    assert(submitTestimonialRes.status === 201, 'Public testimonial submitted as pending');

    // Check public endpoint: MUST NOT contain pending testimonial
    const publicTestimonialsRes1 = await fetch(`${baseUrl}/api/testimonials`);
    const publicTestimonials1 = await publicTestimonialsRes1.json();
    assert(publicTestimonials1.testimonials.length === 0, 'Public /testimonials never leaks pending testimonials');

    // Admin approves testimonial
    const approveRes = await fetch(`${baseUrl}/api/admin/testimonials/${testimonialId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'approved' }),
    });
    const approveJson = await approveRes.json();
    assert(approveRes.status === 200 && approveJson.testimonial.status === 'approved', 'Admin approves testimonial');

    // Check public endpoint again: MUST NOW contain approved testimonial
    const publicTestimonialsRes2 = await fetch(`${baseUrl}/api/testimonials`);
    const publicTestimonials2 = await publicTestimonialsRes2.json();
    assert(publicTestimonials2.testimonials.some((t) => t.name === 'Pastor Michael'), 'Approved testimonial now visible publicly');

    // --- 10. TICKETS & INTERNAL NOTES ---
    console.log('\n--- 10. Tickets & Internal Notes ---');
    const ticketSubmitRes = await fetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regularToken}`,
      },
      body: JSON.stringify({
        email: 'regular@church.org',
        subject: 'Companion pairing question',
        message: 'Need help with QR code pairing on private network.',
      }),
    });
    const ticketJson = await ticketSubmitRes.json();
    const ticketId = ticketJson.ticket.id;
    assert(ticketSubmitRes.status === 201, 'User submits support ticket with 201');

    // Admin adds internal note
    const noteRes = await fetch(`${baseUrl}/api/admin/tickets/${ticketId}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ note: 'Advised user to check local subnet port 4000.' }),
    });
    const noteJson = await noteRes.json();
    assert(noteRes.status === 201 && !!noteJson.note, 'Admin adds internal note to ticket');

    // Admin views full ticket with notes
    const ticketDetailRes = await fetch(`${baseUrl}/api/admin/tickets/${ticketId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const ticketDetailJson = await ticketDetailRes.json();
    assert(ticketDetailRes.status === 200 && ticketDetailJson.notes.length === 1, 'Admin fetches ticket detail with internal notes attached');

    // --- 11. CORS: DESKTOP APP WITHOUT ORIGIN HEADER ---
    console.log('\n--- 11. CORS & Desktop App Headerless Requests ---');
    const noOriginRes = await fetch(`${baseUrl}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: regularToken }),
    });
    assert(noOriginRes.headers.get('access-control-allow-origin') === '*', 'Desktop app request without Origin header permitted by CORS');

    console.log('\n========================================');
    console.log(`VERIFICATION SUMMARY: ${results.filter((r) => r.status === 'PASS').length}/${results.length} PASSED`);
    console.log('========================================\n');
  } catch (err) {
    console.error('Verification failed with error:', err);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
}

run();
