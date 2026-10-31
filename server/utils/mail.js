import nodemailer from 'nodemailer';

let tx;
export const mailReady = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

export async function sendMail({ to, subject, html, attachments }) {
  if (!mailReady()) throw new Error('email is not set up on the server (add the SMTP settings to server/.env)');
  const port = Number(process.env.SMTP_PORT || 465);
  tx ||= nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await tx.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html, attachments });
}
