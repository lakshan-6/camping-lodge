const results = {
  accepted: 'Confirmation email sent for delivery.',
  no_email: 'No email sent: the customer has no email address.',
  invalid_email: 'No email sent: the customer’s email address is invalid.',
  not_configured: 'Confirmation email is not set up yet.',
  failed: 'Email delivery could not be confirmed. Check Brevo Email Logs.',
  already_processed: 'This action was already saved; no duplicate email was sent.',
};

export const emailStatusMessage = status => results[status] || '';
