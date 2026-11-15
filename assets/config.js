/*
 * SeatStory configuration — edit this file after purchase setup.
 *
 * PAYMENT_URL : your payment link (Stripe Payment Link or any checkout page).
 *               The "Unlock" button opens it in a new tab.
 * PRICE_LABEL : the text shown on the unlock button.
 * UNLOCK_CODE : the code you send to a buyer so they can restore the purchase
 *               on another device ("Restore purchase" in the Export tab).
 *
 * SECURITY NOTE — PLEASE READ
 * This is a client-side courtesy lock, NOT fraud-proof protection. The unlock
 * code and the unlock flag live in files and localStorage that the visitor
 * controls, so anyone who reads the source can bypass it. It exists to keep
 * the preview honest before payment and to make restoring a purchase simple.
 * Do not put anything sensitive in this file, and never rely on it to protect
 * data that actually matters.
 */
window.SEATSTORY_CONFIG = {
  PAYMENT_URL: 'https://buy.stripe.com/REPLACE_WITH_YOUR_PAYMENT_LINK',
  PRICE_LABEL: '$29 one-time',
  UNLOCK_CODE: 'SEATSTORY-2026'
};
