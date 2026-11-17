# TASK — Wedding seating chart app ("SeatStory") MVP

Staattiline veebiäpp pulma istumisplaaniks. **Inglise keeles** (sihtturg: UK/US/global).
Eesmärk: paar sisestab külalised, paigutab need laudadele, saab **ilusa printimisvalmis
plakati PDF-ina** ja **QR-lehe "find your seat"**. Tasuline ühekordne ost ($29), ilma
konto ja backendita.

## Arhitektuur ( ranged piirid )

- **Null backendit, null kontot, null analüütikat.** Kogu andmetöötlus brauseris,
  andmed `localStorage`-is, ei saadeta kuhugi serverile.
- **Null välist võrgu­päringut pärast lehe laadimist** — ei CDN-e, ei Google Fontsi,
  ei API-sid. Kõik vajalikud teegid (PDF, QR) on `assets/vendor/` all kohapeal.
  Font: süsteemne font-stack või kohalik woff2.
- Staatiline hostimine (GitHub Pages / Netlify). Avaneb ka `file://` pealt.
- Üks leht `app.html` + `assets/` (CSS/JS eraldi failid on OK, raamistikke ei ole). `index.html` on turundusleht.

## 1. Andmemudel (localStorage)

```
guests: [{ id, name, tableId|null, tags: ["vegan","no-alcohol", ...], note }]
tables: [{ id, label ("Table 1"), capacity (number), shape ("round"|"long") }]
settings: { style, title, names ("Anna & Mark"), date, venue }
```

- `localStorage` võti `seatstory_v1`. Kõik muudatused salvestatakse kohe.
- "Start over" kustutab andmed (kinnitusega).

## 2. Vaated (mobiil esikohal, 390 px)

1. **Guests** — külaliste nimekiri: lisa ükshaaval, kustuta, märgi tagid, otsing.
   **CSV import** (`name,table,tags` — tags eraldatud semikooloniga; tabeli nimi
   valikuline; kui tabelit pole, jääb paigutamata). CSV eksport ka.
2. **Tables** — laudade haldus: lisa/eemalda, nimi, mahutavus, kuju.
3. **Plan** — visuaalne paigutus: lauad plaanil, külalised neis.
   - **Drag & drop** hiirega JA **tap-to-assign** puutel (vali külaline → vali laud).
     Puutel peab töötama ilma drag&dropi õnnestumiseta.
   - Näita: paigutamata külaliste arv, üle mahutavuse laud (punane), otsing.
4. **Export** — stiili valik, eelvaade, allalaadimine.

Navigatsioon: ülemine riba (4 vahekaarti) + sisu. Ühelgi vaatel **ei tohi olla
horisontaalset kerimist 390 px laiusel ekraanil**. Puutealad ≥44 px.

## 3. Eksport (tasuline)

- **3 plakastiili**, mis erinevad päriselt (mitte ainult värvi poolest):
  `Minimal` (valge, peen serif, õhuline), `Botanical` (rohelised oksad/lehed, soe
  beež), `Midnight` (tume taust, kuldne aktsent).
- Plakat sisaldab: pealkiri (nimed + kuupäev), lauad koos külalistega, vormindatud
  printimiseks (A2 püstine proportsioon, 420×594 mm).
- **PDF** (vektor, mitte screenshot) kliendipoolselt; tekst peab olema valitav ja
  terav igas suuruses. Mitme lehekülje tugi, kui laudu/nimesid palju.
- **PNG** (2× skaala) sotsiaalmeedia jaoks.
- **QR-leht "Find your seat"**: A-Z nimekiri (nimi → laua number) + QR-kood, mis
  viib `share.html#<pakiaud data>` lehele, kus külaline saab sisestada oma nime ja
  näeb oma lauda. QR-leht prinditav samamoodi.

## 4. Maksemüür ( Payment gate )

- Konstandid failis `assets/config.js`: `PAYMENT_URL` (Stripe Payment Link) ja
  `PRICE_LABEL` ("$29 one-time").
- Ilma õiguseta: Export vaates on **lukustatud olek** — eelvaade nähtav (vesimärgiga),
  allalaadimine mitte; nupp "Unlock for $29" avab `PAYMENT_URL` uues aknas.
- Õigus tekib, kui URL-is on `?paid=1` (Stripe'i `success_url`) → kirjutatakse
  `localStorage`-i. "Restore purchase" sisestab koodi (konstant `UNLOCK_CODE`).
- **Ole aus koodis kommentaariga:** see on MVP-kaitse, mitte pettumuskindel.
  Ära ehita serveripoolset valideerimist.

## 5. Mida MITTE teha

- Ei kontot, ei e-posti kogumist, ei analüütikat, ei küpsiseid, ei väliseid fonte.
- Ei raamistikke (React/Vue/Tailwind CDN), ei ehitustööriistu, ei TypeScripti.
- Ei serveripoolset koodi, ei andmebaasi, ei autentimist.
- Ei "AI auto-seat" funktsiooni (see on järgmine faas, mitte MVP).
- Ei mitut keelt — ainult inglise keel.

## 6. Vastuvõtukriteeriumid (mida reviewer kontrollib)

1. `app.html` avaneb `file://` pealt ja töötab ilma võrguta (pärast laadimist 0 päringut).
2. 40 külalist + 6 lauda mahuga 8: kõik paigutatavad, "unseated" loend õige,
    üle mahutavuse laud märgitakse punaselt.
3. CSV import 20 reaga loob 20 külalist õigete tagidega; vigane rida ei karga
   terve impordi peale (näidata ridade kaupa viga).
4. 390 px: ükski vaade ei keri horisontaalselt; puutealad ≥44 px.
5. Tap-to-assign töötab ilma drag&dropita (külalise valimine → laua valimine).
6. Eksport ilma `?paid=1`: allalaadimine blokeeritud, eelvaade vesimärgiga,
   "Unlock" nupp viitab `PAYMENT_URL`-ile. `?paid=1` järel allalaadimine töötab.
7. PDF sisaldab kõiki paigutatud külalisi, tekst on valitav (mitte pilt), ja
   mahub lehele ilma kattumiseta; 3 stiili annavad visuaalselt erineva tulemuse.
8. QR-leht genereerib toimiva QR-koodi ja `share.html` kuvab nime otsingul õige laua.
9. JavaScript läbib `node --check`; väliseid võrguaadresse (http/https) ei ole
   HTML/CSS/JS-is peale `PAYMENT_URL` konstandi.
10. Andmed säilivad lehe värskendamisel (`localStorage`), "Start over" kustutab.
