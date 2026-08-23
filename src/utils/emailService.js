const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const env = require('../config/env');
const User = require('../models/User');

let resendClient = null;
let smtpTransporter = null;

function getResendClient() {
  if (resendClient) return resendClient;
  if (env.RESEND_API_KEY) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;

  if (env.SMTP_HOST) {
    smtpTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  } else if (env.SMTP_USER && env.SMTP_PASS) {
    smtpTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  return smtpTransporter;
}

/**
 * Extract user's first name with intelligent title stripping and fallback.
 */
function getFirstName(user) {
  if (user && user.name && user.name.trim()) {
    const cleanName = user.name.trim().replace(/^(Worship Pastor|Pastor|Reverend|Rev|Bishop|Apostle|Minister|Elder|Deacon|Dr|Mr|Mrs|Ms)\.?\s+/i, '');
    return cleanName.split(' ')[0] || user.name.trim().split(' ')[0];
  }
  if (user && user.email) {
    const localPart = user.email.split('@')[0];
    return localPart.charAt(0).toUpperCase() + localPart.slice(1);
  }
  return 'there';
}

/**
 * Calculate user's plan name, expiration date string, and days remaining.
 */
function getPlanDetails(user) {
  const tier = (user.subscriptionTier || 'trial').toLowerCase();
  const planName = tier === 'trial' ? 'Trial' : tier.charAt(0).toUpperCase() + tier.slice(1);
  
  const expiry = user.subscriptionExpiresAt || user.trialEndsAt || user.graceExpiresAt;
  const expiryDate = expiry 
    ? new Date(expiry).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Soon';
  
  let daysRemaining = 0;
  if (typeof user.getTrialRemainingDays === 'function' && tier === 'trial') {
    daysRemaining = user.getTrialRemainingDays();
  } else if (expiry) {
    const diffMs = new Date(expiry).getTime() - Date.now();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  return { planName, expiryDate, daysRemaining };
}

/**
 * Helper to render responsive, clean HTML email layout.
 */
function renderHtmlContainer({ heading, bodyHtml, ctaText, ctaUrl, secondaryCtaText, secondaryCtaUrl, signoffHtml }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${heading || 'OCS Notification'}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.6;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 32px 16px;">
        <tr>
          <td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
              
              <!-- Header Bar -->
              <tr>
                <td style="padding: 24px 32px 16px 32px; border-bottom: 1px solid #f1f5f9;">
                  <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">OCS</span>
                  <span style="font-size: 13px; color: #64748b; margin-left: 8px;">Organised Church Service</span>
                </td>
              </tr>

              <!-- Main Content -->
              <tr>
                <td style="padding: 32px;">
                  ${heading ? `<h1 style="font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 20px 0; line-height: 1.3;">${heading}</h1>` : ''}
                  
                  <div style="font-size: 15px; color: #334155; line-height: 1.6;">
                    ${bodyHtml}
                  </div>

                  ${ctaText && ctaUrl ? `
                    <div style="margin: 28px 0; text-align: center;">
                      <a href="${ctaUrl}" style="background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 8px; display: inline-block; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
                        ${ctaText}
                      </a>
                    </div>
                  ` : ''}

                  ${secondaryCtaText && secondaryCtaUrl ? `
                    <div style="margin: 24px 0 16px 0; text-align: center;">
                      <a href="${secondaryCtaUrl}" style="background-color: #2563eb; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 10px 24px; border-radius: 6px; display: inline-block;">
                        ${secondaryCtaText}
                      </a>
                    </div>
                  ` : ''}

                  ${signoffHtml ? `
                    <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 14px; color: #475569;">
                      ${signoffHtml}
                    </div>
                  ` : ''}
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
                  © ${new Date().getFullYear()} Organised Church Service. All rights reserved.
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

/**
 * Core generic email dispatch function.
 * Uses Resend HTTP API when RESEND_API_KEY is configured.
 * In test environment or when API key is not configured, logs safely and returns simulation metadata.
 * 
 * @param {Object} options
 * @param {string|string[]} options.to Recipient email(s)
 * @param {string} options.subject Email subject line
 * @param {string} options.html HTML email body
 * @param {string} [options.text] Plain text email body
 * @param {string} [options.from] Optional sender override
 */
async function sendEmail({ to, subject, html, text, from }) {
  const recipients = Array.isArray(to) ? to : [to];
  const cleanRecipients = recipients.map((r) => r && r.trim()).filter(Boolean);

  if (cleanRecipients.length === 0) {
    console.warn('[EmailService] No valid recipient specified.');
    return { skipped: true, reason: 'no_recipients' };
  }

  const sender = from || env.RESEND_FROM_EMAIL || env.FROM_EMAIL || "OCS <onboarding@resend.dev>";

  // In test environment, return simulated delivery
  if (env.NODE_ENV === 'test') {
    const simulatedId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return { success: true, messageId: simulatedId, simulated: true };
  }

  let lastError = null;

  // 1. Primary Engine: Resend HTTP API
  if (env.RESEND_API_KEY) {
    try {
      const resend = getResendClient();
      const response = await resend.emails.send({
        from: sender,
        to: cleanRecipients,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ' '),
      });

      if (!response.error) {
        console.log(`[EmailService] ✅ Email delivered via Resend to ${cleanRecipients.join(', ')} (ID: ${response.data?.id})`);
        return { success: true, provider: 'resend', messageId: response.data?.id, data: response.data };
      }

      lastError = response.error.message || response.error;
      console.warn(`[EmailService] ⚠️ Resend dispatch error:`, lastError);

      if (response.error.statusCode === 403 || String(lastError).includes('testing emails') || String(lastError).includes('verify a domain')) {
        console.warn(`[EmailService] ℹ️ Resend Domain Verification Required: Resend's test sender (onboarding@resend.dev) can only send to your account email (waveiosoftware@gmail.com). To send to real customer emails, verify your domain at https://resend.com/domains and set RESEND_FROM_EMAIL (e.g. notifications@churchocs.com) in .env.`);
      }
    } catch (err) {
      lastError = err.message;
      console.warn(`[EmailService] ⚠️ Resend exception:`, err.message);
    }
  }

  // 2. Secondary Engine: Nodemailer SMTP Fallback
  const smtp = getSmtpTransporter();
  if (smtp) {
    try {
      const info = await smtp.sendMail({
        from: env.FROM_EMAIL || sender,
        to: cleanRecipients,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ' '),
      });
      console.log(`[EmailService] ✅ Email delivered via SMTP fallback to ${cleanRecipients.join(', ')} (Message ID: ${info.messageId})`);
      return { success: true, provider: 'smtp', messageId: info.messageId };
    } catch (err) {
      lastError = err.message;
      console.error(`[EmailService] ❌ SMTP fallback error:`, err.message);
    }
  }

  // 3. Fallback when neither engine was configured
  if (!env.RESEND_API_KEY && !smtp) {
    console.log(`\n========================================`);
    console.log(`[Email Dispatched (No Provider Credentials Configured)]`);
    console.log(`From: ${sender}`);
    console.log(`To: ${cleanRecipients.join(', ')}`);
    console.log(`Subject: ${subject}`);
    console.log(`Message Preview:\n${text || html.replace(/<[^>]+>/g, ' ').slice(0, 200)}...`);
    console.log(`========================================\n`);
    return { success: true, simulated: true, reason: 'no_provider_configured' };
  }

  return { success: false, error: lastError || 'Failed to dispatch email via configured providers.' };
}

/**
 * Trigger 1: Send notification to platform staff when a new support ticket drops (FR-15.2 item 1).
 * @param {Object} ticket
 */
async function sendTicketNotification(ticket) {
  const recipients = env.NOTIFICATION_EMAILS.split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  const priorityColor = ticket.priority === 'high' ? '#dc2626' : ticket.priority === 'normal' ? '#2563eb' : '#6b7280';

  const bodyHtml = `
    <p style="font-size: 14px; color: #475569; margin-top: 0;">A new support ticket has been submitted to the OCS platform.</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
      <tr>
        <td style="padding: 8px 0; font-weight: bold; width: 120px; color: #475569;">Ticket ID:</td>
        <td style="padding: 8px 0; font-family: monospace; color: #0f172a;">${ticket.id || ticket._id}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: bold; color: #475569;">Submitter:</td>
        <td style="padding: 8px 0;"><a href="mailto:${ticket.email}" style="color: #2563eb; text-decoration: none;">${ticket.email}</a></td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: bold; color: #475569;">Priority:</td>
        <td style="padding: 8px 0;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; color: #ffffff; background-color: ${priorityColor};">
            ${(ticket.priority || 'NORMAL').toUpperCase()}
          </span>
        </td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-weight: bold; color: #475569;">Subject:</td>
        <td style="padding: 8px 0; font-weight: 600; color: #0f172a;">${ticket.subject}</td>
      </tr>
    </table>

    <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 14px; border-radius: 4px; margin: 16px 0;">
      <h4 style="margin: 0 0 6px 0; color: #334155; font-size: 13px; text-transform: uppercase;">Message:</h4>
      <p style="margin: 0; white-space: pre-wrap; font-size: 14px; color: #1e293b; line-height: 1.5;">${ticket.message}</p>
    </div>

    <p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
      Submitted at: ${new Date(ticket.createdAt || Date.now()).toUTCString()}
    </p>
  `;

  const html = renderHtmlContainer({
    heading: '🎫 New OCS Support Ticket',
    bodyHtml,
    ctaText: 'View in Admin Console',
    ctaUrl: `${env.FRONTEND_URL}/admin`,
  });

  const text = `New OCS Support Ticket\n\nTicket ID: ${ticket.id || ticket._id}\nSubmitter: ${ticket.email}\nPriority: ${ticket.priority}\nSubject: ${ticket.subject}\n\nMessage:\n${ticket.message}\n\nSubmitted at: ${new Date(ticket.createdAt || Date.now()).toUTCString()}`;

  return module.exports.sendEmail({
    to: recipients,
    subject: `[New OCS Ticket] ${ticket.subject} (${(ticket.priority || 'NORMAL').toUpperCase()})`,
    html,
    text,
  });
}

/**
 * Trigger 2: Send notification to the submitter when ticket status changes (FR-15.2 item 2).
 * @param {Object} ticket Updated ticket
 * @param {string} newStatus 'open' | 'in_progress' | 'resolved'
 */
async function sendTicketStatusNotification(ticket, newStatus) {
  if (!ticket.email) return { skipped: true, reason: 'no_ticket_email' };

  const statusLabel = {
    open: 'Open',
    in_progress: 'In Progress',
    resolved: 'Resolved',
  }[newStatus] || newStatus;

  const statusColor = newStatus === 'resolved' ? '#16a34a' : newStatus === 'in_progress' ? '#eab308' : '#2563eb';

  const bodyHtml = `
    <p style="font-size: 14px; color: #475569;">Hello,</p>
    <p style="font-size: 14px; color: #475569;">Your support ticket <strong>#${ticket.id || ticket._id}</strong> has been updated.</p>
    
    <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 16px 0; border: 1px solid #e2e8f0;">
      <p style="margin: 0 0 8px 0; font-size: 14px; color: #334155;"><strong>Subject:</strong> ${ticket.subject}</p>
      <p style="margin: 0; font-size: 14px; color: #334155;">
        <strong>Current Status:</strong>
        <span style="display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; color: #ffffff; background-color: ${statusColor};">
          ${statusLabel.toUpperCase()}
        </span>
      </p>
    </div>

    <p style="font-size: 14px; color: #475569; line-height: 1.5;">
      ${newStatus === 'resolved' 
        ? 'Our team has marked this ticket as resolved. If you have any further questions or need additional assistance, please reply to this email or submit a new ticket.' 
        : 'Our support team is actively reviewing your request. We will keep you updated as we make progress.'}
    </p>
  `;

  const html = renderHtmlContainer({
    heading: 'Ticket Status Update',
    bodyHtml,
    ctaText: 'Visit OCS Support',
    ctaUrl: `${env.FRONTEND_URL}/support`,
    signoffHtml: 'Cheers,<br><strong>The OCS Team</strong>',
  });

  const text = `Ticket Status Update\n\nYour support ticket #${ticket.id || ticket._id} ("${ticket.subject}") has been updated to: ${statusLabel.toUpperCase()}.\n\nVisit ${env.FRONTEND_URL}/support for more details.\n\nCheers,\nThe OCS Team`;

  return module.exports.sendEmail({
    to: ticket.email,
    subject: `[OCS Support] Ticket Status Updated: ${ticket.subject}`,
    html,
    text,
  });
}

/**
 * Trigger 3: Send welcome email upon new account registration.
 * Matches registration.md template exactly.
 * @param {Object} user
 */
async function sendWelcomeEmail(user) {
  if (!user.email) return { skipped: true, reason: 'no_user_email' };

  const firstName = getFirstName(user);

  const bodyHtml = `
    <p>My name is <strong>Oluwasegun</strong>, and I'm one of the people behind <strong>OCS</strong>.</p>
    
    <p>We built OCS with a simple goal: to make church production, presentations, timers, songs, and broadcasts easier to manage from one place.</p>
    
    <p>No jumping between multiple applications. No unnecessary complexity. Just the tools you need to run things smoothly.</p>
    
    <p>Your OCS account has been successfully created, and you can now start exploring the platform.</p>
    
    <p>Here are a few things you can do to get started:</p>
    
    <ol style="padding-left: 20px; margin: 16px 0;">
      <li style="margin-bottom: 8px;"><strong>Set up your first presentation or scene</strong></li>
      <li style="margin-bottom: 8px;"><strong>Explore the Timer and Broadcast features</strong></li>
      <li style="margin-bottom: 8px;"><strong>Connect your mobile devices</strong></li>
      <li style="margin-bottom: 8px;"><strong>Try out the features available in your current access period</strong></li>
    </ol>
  `;

  const signoffHtml = `
    <p style="margin: 0 0 16px 0;">You're currently getting started with OCS, and I genuinely hope it helps make your workflow easier.</p>
    <p style="margin: 0 0 16px 0;">We're still building and improving OCS, so if you ever have feedback, ideas, or run into something that doesn't feel right, just hit <strong>Reply</strong> and let me know.</p>
    <p style="margin: 0 0 20px 0;">I read the messages.</p>
    <p style="margin: 0;">Cheers,<br><strong>Oluwasegun</strong><br><em>Founder, OCS</em></p>
  `;

  const html = renderHtmlContainer({
    heading: `Hey ${firstName},`,
    bodyHtml,
    ctaText: 'Open OCS',
    ctaUrl: env.FRONTEND_URL,
    signoffHtml,
  });

  const text = `Hey ${firstName},\n\nMy name is Oluwasegun, and I'm one of the people behind OCS.\n\nWe built OCS with a simple goal: to make church production, presentations, timers, songs, and broadcasts easier to manage from one place.\n\nNo jumping between multiple applications. No unnecessary complexity. Just the tools you need to run things smoothly.\n\nYour OCS account has been successfully created, and you can now start exploring the platform.\n\nHere are a few things you can do to get started:\n\n1. Set up your first presentation or scene\n2. Explore the Timer and Broadcast features\n3. Connect your mobile devices\n4. Try out the features available in your current access period\n\nOpen OCS: ${env.FRONTEND_URL}\n\nYou're currently getting started with OCS, and I genuinely hope it helps make your workflow easier.\n\nWe're still building and improving OCS, so if you ever have feedback, ideas, or run into something that doesn't feel right, just hit Reply and let me know.\n\nI read the messages.\n\nCheers,\nOluwasegun\nFounder, OCS`;

  return module.exports.sendEmail({
    to: user.email,
    subject: `Hey ${firstName}, welcome to OCS!`,
    html,
    text,
  });
}

/**
 * Trigger 4: Send password reset link with single-use token.
 * Matches registration.md reset template exactly.
 * @param {Object} user User object containing email and name
 * @param {string} rawToken Unhashed password reset token
 */
async function sendPasswordResetEmail(user, rawToken) {
  if (!user.email) return { skipped: true, reason: 'no_user_email' };

  const firstName = getFirstName(user);
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;

  const bodyHtml = `
    <p>Hey ${firstName},</p>
    <p>We received a request to reset the password for your <strong>OCS account</strong>.</p>
    <p>Click the button below to create a new password.</p>
  `;

  const signoffHtml = `
    <p style="margin: 0 0 12px 0;">This password reset link will expire in <strong>1 hour</strong>.</p>
    <p style="margin: 0 0 12px 0;">If you didn't request a password reset, you can safely ignore this email. Your account and password will remain unchanged.</p>
    <p style="margin: 0 0 20px 0;">For security reasons, please do not share this link with anyone.</p>
    <p style="margin: 0;">Cheers,<br><strong>The OCS Team</strong></p>
  `;

  const html = renderHtmlContainer({
    heading: 'Reset your password',
    bodyHtml,
    ctaText: 'Reset Password',
    ctaUrl: resetUrl,
    signoffHtml,
  });

  const text = `Reset your password\n\nHey ${firstName},\n\nWe received a request to reset the password for your OCS account.\n\nClick the link below to create a new password:\n${resetUrl}\n\nThis password reset link will expire in 1 hour.\n\nIf you didn't request a password reset, you can safely ignore this email. Your account and password will remain unchanged.\n\nFor security reasons, please do not share this link with anyone.\n\nCheers,\nThe OCS Team`;

  return module.exports.sendEmail({
    to: user.email,
    subject: `Reset your password`,
    html,
    text,
  });
}

/**
 * Subscription Reminder: 10 Days Before Expiration.
 * Matches registration.md 10-day template exactly.
 * @param {Object} user
 */
async function sendSubscription10DaysReminderEmail(user) {
  if (!user.email) return { skipped: true, reason: 'no_user_email' };

  const firstName = getFirstName(user);
  const { planName, expiryDate } = getPlanDetails(user);

  const bodyHtml = `
    <p>Hey ${firstName},</p>
    <p>Just a quick reminder—your <strong>OCS ${planName} subscription</strong> will expire in <strong>10 days</strong>.</p>
    <p>Once your subscription expires, some of the features you currently have access to will be locked.</p>
    <p>You can renew or upgrade your subscription now to continue enjoying your current features without interruption.</p>
    
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <h3 style="font-size: 14px; font-weight: 700; color: #0f172a; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">Your current plan</h3>
      <p style="margin: 0 0 6px 0; font-size: 14px; color: #334155;"><strong>Plan:</strong> ${planName}</p>
      <p style="margin: 0 0 6px 0; font-size: 14px; color: #334155;"><strong>Expiration date:</strong> ${expiryDate}</p>
      <p style="margin: 0; font-size: 14px; color: #334155;"><strong>Days remaining:</strong> 10</p>
    </div>
  `;

  const signoffHtml = `
    <p style="margin: 0 0 20px 0;">Renewing before your subscription expires ensures that you can continue using your OCS features without interruption.</p>
    <p style="margin: 0;">Cheers,<br><strong>The OCS Team</strong></p>
  `;

  const html = renderHtmlContainer({
    heading: 'Your OCS subscription expires in 10 days',
    bodyHtml,
    ctaText: 'Manage Subscription',
    ctaUrl: `${env.FRONTEND_URL}/pricing`,
    signoffHtml,
  });

  const text = `Your OCS subscription expires in 10 days\n\nHey ${firstName},\n\nJust a quick reminder—your OCS ${planName} subscription will expire in 10 days.\n\nOnce your subscription expires, some of the features you currently have access to will be locked.\n\nYou can renew or upgrade your subscription now to continue enjoying your current features without interruption:\n${env.FRONTEND_URL}/pricing\n\nYour current plan:\nPlan: ${planName}\nExpiration date: ${expiryDate}\nDays remaining: 10\n\nRenewing before your subscription expires ensures that you can continue using your OCS features without interruption.\n\nCheers,\nThe OCS Team`;

  return module.exports.sendEmail({
    to: user.email,
    subject: `Your OCS subscription expires in 10 days`,
    html,
    text,
  });
}

/**
 * Subscription Reminder: Urgent 5-to-0 Days Before Expiration.
 * Matches registration.md 5-0 days template exactly.
 * @param {Object} user
 * @param {number} [daysRemainingOverride]
 */
async function sendSubscriptionUrgentReminderEmail(user, daysRemainingOverride) {
  if (!user.email) return { skipped: true, reason: 'no_user_email' };

  const firstName = getFirstName(user);
  const details = getPlanDetails(user);
  const planName = details.planName;
  const expiryDate = details.expiryDate;
  const daysRemaining = typeof daysRemainingOverride === 'number' ? daysRemainingOverride : details.daysRemaining;

  const daysText = daysRemaining === 0 ? 'today' : `in just ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
  const daysBadge = daysRemaining === 0 ? 'Expires Today' : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;

  const bodyHtml = `
    <p>Hey ${firstName},</p>
    <p>Your <strong>OCS ${planName} subscription</strong> will expire ${daysText}.</p>
    <p>After ${expiryDate}, your subscription will expire and features included in your current plan may become unavailable.</p>
    <p>You can renew your subscription now to keep uninterrupted access to your OCS setup.</p>
    
    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <h3 style="font-size: 14px; font-weight: 700; color: #991b1b; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.5px;">Subscription details</h3>
      <p style="margin: 0 0 6px 0; font-size: 14px; color: #334155;"><strong>Plan:</strong> ${planName}</p>
      <p style="margin: 0 0 6px 0; font-size: 14px; color: #334155;"><strong>Expiration date:</strong> ${expiryDate}</p>
      <p style="margin: 0; font-size: 14px; color: #991b1b;"><strong>Days remaining:</strong> <strong>${daysBadge}</strong></p>
    </div>
  `;

  const signoffHtml = `
    <p style="margin: 0 0 12px 0;">Don't wait until you need OCS during an important event or presentation.</p>
    <p style="margin: 0 0 20px 0;">Renew now and keep everything running smoothly.</p>
    <p style="margin: 0;">Cheers,<br><strong>The OCS Team</strong></p>
  `;

  const heading = daysRemaining === 0
    ? 'Your OCS subscription expires today'
    : `Only ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left on your OCS subscription`;

  const html = renderHtmlContainer({
    heading,
    bodyHtml,
    ctaText: 'Renew Subscription',
    ctaUrl: `${env.FRONTEND_URL}/pricing`,
    secondaryCtaText: 'Renew My Subscription',
    secondaryCtaUrl: `${env.FRONTEND_URL}/pricing`,
    signoffHtml,
  });

  const text = `${heading}\n\nHey ${firstName},\n\nYour OCS ${planName} subscription will expire ${daysText}.\n\nAfter ${expiryDate}, your subscription will expire and features included in your current plan may become unavailable.\n\nYou can renew your subscription now to keep uninterrupted access to your OCS setup:\n${env.FRONTEND_URL}/pricing\n\nSubscription details:\nPlan: ${planName}\nExpiration date: ${expiryDate}\nDays remaining: ${daysBadge}\n\nDon't wait until you need OCS during an important event or presentation.\n\nRenew now and keep everything running smoothly.\n\nCheers,\nThe OCS Team`;

  return module.exports.sendEmail({
    to: user.email,
    subject: heading,
    html,
    text,
  });
}

/**
 * Unified Subscription Reminder Router:
 * Selects 10-day or 5-0 day template based on remaining days.
 * @param {Object} user
 * @param {number} [daysRemainingOverride]
 */
async function sendSubscriptionReminderEmail(user, daysRemainingOverride) {
  const details = getPlanDetails(user);
  const daysRemaining = typeof daysRemainingOverride === 'number' ? daysRemainingOverride : details.daysRemaining;

  if (daysRemaining > 5 && daysRemaining <= 10) {
    return module.exports.sendSubscription10DaysReminderEmail(user);
  }
  if (daysRemaining <= 5 && daysRemaining >= 0) {
    return module.exports.sendSubscriptionUrgentReminderEmail(user, daysRemaining);
  }
  return { skipped: true, reason: 'outside_reminder_window', daysRemaining };
}

/**
 * Automated sweep to check and dispatch expiration reminders
 * for all users with 10 to 0 days remaining on their trial or paid plan.
 */
async function checkAndSendSubscriptionReminders() {
  const now = new Date();
  const tenDaysFromNow = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

  // Find users whose trial or paid subscription expires within the next 10 days
  const users = await User.find({
    subscriptionTier: { $in: ['trial', 'mini', 'standard', 'large', 'premium'] },
    $or: [
      {
        subscriptionExpiresAt: { $ne: null, $lte: tenDaysFromNow, $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      {
        subscriptionExpiresAt: null,
        trialEndsAt: { $ne: null, $lte: tenDaysFromNow, $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    ],
  });

  const results = {
    totalChecked: users.length,
    sent: 0,
    skipped: 0,
    errors: 0,
  };

  const oneDayMs = 24 * 60 * 60 * 1000;

  for (const user of users) {
    try {
      const details = getPlanDetails(user);
      const days = details.daysRemaining;

      if (days > 10 || days < 0) {
        results.skipped++;
        continue;
      }

      // Check if reminder was already sent today for this user
      if (user.lastSubscriptionReminderSentAt) {
        const timeSinceLast = Date.now() - new Date(user.lastSubscriptionReminderSentAt).getTime();
        if (timeSinceLast < oneDayMs) {
          results.skipped++;
          continue;
        }
      }

      const reminderType = days > 5 ? '10_days' : 'urgent_5_0_days';
      const sendRes = await module.exports.sendSubscriptionReminderEmail(user, days);

      if (sendRes && sendRes.success) {
        user.lastSubscriptionReminderSentAt = new Date();
        user.lastSubscriptionReminderType = reminderType;
        await user.save();
        results.sent++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      console.error(`[SubscriptionReminder] Failed for user ${user.email}:`, err.message);
      results.errors++;
    }
  }

  return results;
}

module.exports = {
  sendEmail,
  sendTicketNotification,
  sendTicketStatusNotification,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendSubscription10DaysReminderEmail,
  sendSubscriptionUrgentReminderEmail,
  sendSubscriptionReminderEmail,
  checkAndSendSubscriptionReminders,
  getFirstName,
  getPlanDetails,
};
