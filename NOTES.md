# SeatStory — where this build departs from TASK.md / PLAN.md

TASK.md and PLAN.md are left untouched on purpose; this file records the decisions
that differ from them, so a reviewer can check the intent instead of guessing.

1. **One extra HTML page.** `index.html` is still the tool, as TASK.md says;
   `landing.html` is the marketing page and `share.html` the guest search page.
   All three work from `file://` and make no network requests after load. The
   landing page exists so a buyer can be sent somewhere with the price and the
   three styles before opening the builder.

2. **Embedded fonts instead of the standard PDF fonts.** The plan assumed
   `Times`/`Helvetica`. The poster now embeds EB Garamond and Inter subsets:
   `assets/vendor/fonts.js` (base64 TTF for pdf-lib), `assets/vendor/fonts.css`
   (woff2 for the canvas preview), `assets/vendor/fontkit.umd.js` (pdf-lib needs
   fontkit to read a TTF), `assets/vendor/OFL.txt` (licence). Reason: a print shop
   must not substitute the typeface, and a PDF with unembedded fonts is a support
   ticket waiting to happen. Trade-off: ~900 KB more to load, still zero requests
   after load.

3. **Vendor files are committed.** `.gitignore` no longer hides `assets/vendor/`,
   because a static deployment has to work from a clean checkout with no `npm`
   step. `plan_out.md` and `review_out.json` stay ignored.

4. **`assets/samples/*.jpg`** are the five Etsy/landing images (2000×2000) that
   `index.html` shows. They are page assets, not part of the tool.

5. **Sparse-poster layout.** With few tables the poster used to leave most of the
   A2 sheet empty and stack everything in the left column. The block typography now
   scales up to 1.45× and the title plus blocks are centred as one group when the
   content comfortably fits. The QR sheet opts out with `balance: false` and keeps
   its own column grid.

6. **Known gap: the Stripe link.** `assets/config.js` still carries
   `REPLACE_WITH_YOUR_PAYMENT_LINK`; the payment page has to be created by the
   seller. Nothing else in the purchase flow is a placeholder.
