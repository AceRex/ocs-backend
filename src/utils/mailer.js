const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  // Determine transport configuration
  if (env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  } else if (env.SMTP_USER && env.SMTP_PASS) {
    // Default to Gmail service if user/pass provided without custom host
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  return transporter;
}

/**
 * Dispatch an immediate email notification when a new support ticket drops.
 * Sends to configured notification recipients (johnsonare0722@gmail.com, waveiosoftware@gmail.com).
 * @param {Object} ticket Ticket document
 */
async function sendTicketNotification(ticket) {
  // In test environment, skip sending real emails
  if (env.NODE_ENV === 'test') {
    return { skipped: true, reason: 'test_env' };
  }

  const recipients = env.NOTIFICATION_EMAILS.split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    console.warn('[Mailer] No notification recipients configured.');
    return { skipped: true, reason: 'no_recipients' };
  }

  const mailTransporter = getTransporter();
  if (!mailTransporter) {
    console.log(`\n========================================`);
    console.log(`[Ticket Notification Email (SMTP Not Configured)]`);
    console.log(`To: ${recipients.join(', ')}`);
    console.log(`Subject: [New OCS Ticket] ${ticket.subject} (Priority: ${ticket.priority.toUpperCase()})`);
    console.log(`From: ${ticket.email}`);
    console.log(`Message: ${ticket.message}`);
    console.log(`Ticket ID: ${ticket.id || ticket._id}`);
    console.log(`========================================\n`);
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">🎫 New OCS Support Ticket</h2>
      <p style="font-size: 14px; color: #555;">A new support ticket has been submitted to the OCS platform.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px; font-weight: bold; width: 120px; color: #333;">Ticket ID:</td>
          <td style="padding: 8px; font-family: monospace; color: #4b5563;">${ticket.id || ticket._id}</td>
        </tr>
        <tr style="background-color: #f9fafb;">
          <td style="padding: 8px; font-weight: bold; color: #333;">Submitter:</td>
          <td style="padding: 8px;"><a href="mailto:${ticket.email}" style="color: #2563eb;">${ticket.email}</a></td>
        </tr>
        <tr>
          <td style="padding: 8px; font-weight: bold; color: #333;">Priority:</td>
          <td style="padding: 8px;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; color: #fff; background-color: ${
              ticket.priority === 'high' ? '#dc2626' : ticket.priority === 'normal' ? '#2563eb' : '#6b7280'
            };">
              ${ticket.priority.toUpperCase()}
            </span>
          </td>
        </tr>
        <tr style="background-color: #f9fafb;">
          <td style="padding: 8px; font-weight: bold; color: #333;">Subject:</td>
          <td style="padding: 8px; font-weight: bold; color: #111827;">${ticket.subject}</td>
        </tr>
      </table>

      <div style="background-color: #f3f4f6; padding: 14px; border-radius: 6px; margin: 16px 0;">
        <h4 style="margin: 0 0 8px 0; color: #374151;">Message:</h4>
        <p style="margin: 0; white-space: pre-wrap; font-size: 14px; color: #1f2937;">${ticket.message}</p>
      </div>

      <p style="font-size: 12px; color: #9ca3af; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
        Submitted at: ${new Date(ticket.createdAt || Date.now()).toLocaleString()}
      </p>
    </div>
  `;

  const textContent = `New OCS Support Ticket\n\nTicket ID: ${ticket.id || ticket._id}\nSubmitter: ${ticket.email}\nPriority: ${ticket.priority}\nSubject: ${ticket.subject}\n\nMessage:\n${ticket.message}\n\nSubmitted at: ${new Date(ticket.createdAt || Date.now()).toLocaleString()}`;

  try {
    const info = await mailTransporter.sendMail({
      from: env.FROM_EMAIL,
      to: recipients,
      subject: `[OCS Ticket] ${ticket.subject} (${ticket.priority.toUpperCase()})`,
      text: textContent,
      html: htmlContent,
    });

    console.log(`[Mailer] Ticket notification sent successfully to ${recipients.join(', ')} (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Mailer] Failed to send ticket email notification:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendTicketNotification,
};
