import { sendInvoiceWhatsApp } from '../whatsapp.js';

export default function WhatsAppPrompt({ invoiceId, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="invoice" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <h2>Send the invoice on WhatsApp</h2>
        <p>This opens WhatsApp with the message ready, and saves the invoice PDF so you can attach it (paperclip, then Document).</p>
        <div className="row end"><button onClick={onClose}>Close</button>
          <button className="btn" onClick={() => { sendInvoiceWhatsApp(invoiceId); onClose(); }}>Open WhatsApp</button></div>
      </div>
    </div>
  );
}
