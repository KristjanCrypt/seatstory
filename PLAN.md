## Eesmärk
Luua SeatStory: ingliskeelne mobiilisõbralik staatiline pulma istumisplaani äpp, mis salvestab andmed brauseris ning ekspordib plakati ja otsitava QR-lehe. Olemas on TASK.md, kaks nõutud teeki ja töövoofailid; tootekoodi veel pole.

## Nõuded
1. `app.html` ja `share.html` töötavad `file://` ning staatilises hostis; rakendus ei tee pärast laadimist võrgupäringuid. `index.html` on turundusleht, mis viib `app.html`-i.
2. `seatstory_v1` säilitab TASK.md külaliste, laudade ja seadistuste mudeli ning ostuõiguse; iga muudatus salvestub kohe. Kinnitusega „Start over” kustutab istumisplaani, säilitades ostuõiguse.
3. Guests võimaldab lisada/kustutada külalisi, muuta nime, tage ja märkust ning otsida; Tables võimaldab lisada/eemaldada laudu ning muuta nime, positiivset täisarvulist mahutavust ja kuju.
4. CSV import/eksport kasutab päist `name,table,tags`, toetab jutumärke, komasid ja semikooloniga tage; vigased read saavad reanumbriga vea, kehtivad imporditakse. Tundmatu või tühi laud jätab külalise paigutamata.
5. Plan näitab laudade kuju, külalisi, täituvust, paigutamata arvu ja otsingut; toetab hiirega lohistamist, puudutusega „külaline → laud” määramist ning paigutuse eemaldamist. Ületäituvus on lubatud, kuid punaselt märgitud; laua kustutamine vabastab külalised.
6. Kõik neli vahekaarti töötavad 390 px laiuses horisontaalse kerimiseta; puutealad on vähemalt 44 × 44 px.
7. Export võimaldab muuta pealkirja, nimesid, kuupäeva ja kohta ning valida erineva kompositsiooniga Minimal-, Botanical- ja Midnight-stiili; eelvaade vastab ekspordile.
8. Plakat on A2 püstformaadis (420 × 594 mm), valitava vektortekstiga PDF; pikk sisu jätkub kattumiseta lisalehtedel. PNG kasutab sama kujundust 2× mõõdus, vajadusel failina iga lehe kohta.
9. „Find your seat” prinditav leht sisaldab A–Z nimekirja ja QR-koodi; fragment kannab ainult nime ja laua andmeid. `share.html` otsib nime tõstutundetult ning näitab kõiki vasteid või puuduvat paigutust.
10. Lukus ekspordil on vesimärk ning kõik allalaadimised blokeeritud; ostunupp avab konfiguratsiooni `PAYMENT_URL` uues aknas. `?paid=1` või õige `UNLOCK_CODE` annab püsiva õiguse; vale kood näitab viga. Kommentaar ütleb selgelt, et kaitse pole pettusekindel.
11. QR jagamisbaas tuletatakse hostitud lehe aadressist; `file://` korral küsitakse hostitud `share.html` aadressi. Liiga suur QR-andmestik ja vigane fragment annavad arusaadava vea.

## Failid
Luuakse `index.html` (turundusleht), `app.html` (rakendus), `share.html` (külalise otsing), `assets/styles.css`, `assets/config.js`, `assets/app.js`, `assets/samples/*.jpg` (Etsy/landingu pildid).
Ekspordi- ja jagamisloogika jäävad **`app.js`-i ühte faili**: ilma ehitustööriistata
(plaan keelab need) on mitme skripti laadimisjärjekord katki minev risk, mis kaalub
üles faili suuruse. `config.js` sisaldab `PAYMENT_URL`, `PRICE_LABEL` (`$29 one-time`)
ja `UNLOCK_CODE`; olemasolevad vendor-teegid, TASK.md ja töövoofailid jäävad muutmata.

**Fondid (otsus 16.11):** PDF ei kasuta enam standardfonte. `assets/vendor/fonts.js`
sisaldab EB Garamondi ja Interi alamosasid base64-na ning `assets/vendor/fontkit.umd.js`
on pdf-libil fontide manustamiseks; `assets/vendor/fonts.css` annab samad lõiked
eelvaatele. Nii on plakatil päris tüpograafia, PDF kannab fondid ise kaasas ega sõltu
trükikoja masinast. Vendor-failid on **git-repos** (välja arvatud `plan_out.md` ja
`review_out.json`), sest staatiline juurutus peab töötama ilma `npm`-i ja võrguühenduseta.
EB Garamond ja Inter on SIL OFL 1.1 litsentsi all; litsentsitekst on `assets/vendor/OFL.txt`.

## Sammud
1. Loo klassikaliste skriptidega HTML/CSS kest, konfiguratsioon, andmemudel, salvestamine ja nelja vahekaardi navigatsioon.
2. Teosta külaliste/laudade CRUD, CSV import/eksport ja reavigade kuvamine.
3. Lisa plaani vaade, otsing, lohistamine, puudutusega määramine ja täituvus.
4. Ehita ühine lehekülgede paigutusarvutus PDF-i, Canvas-PNG ja eelvaate jaoks; kasuta ainult olemasolevaid PDF/QR teeke ning süsteemi- ja PDF-i sisefonte.
5. Lisa maksemüür, taastamine, QR-leht ja fragmenti lugev otsing; kuva toetamata märgi või ekspordivea korral selge teade.
6. Käivita alltoodud käsitsi kontrollid ja süntaksikontroll; paranda leitud vead.

## Vastuvõtukriteeriumid
1. Ava `index.html` failina ja staatilises hostis; testi võrguühenduseta CRUD-i, värskendamisel säilimist ning „Start over” tühistamist/kinnitamist.
2. Lisa 40 külalist ja 6 lauda mahuga 8: `6 × 8 = 48`, `48 − 40 = 8` vaba kohta. Jaotus `8,8,8,8,8,0` annab paigutamata arvuks `0`; jaotus `9,8,8,8,7,0` jätab selle `0`, esimene laud on punane. Ühe külalise vabastamisel on arv `1`.
3. Impordi 20 kehtivat CSV-rida: tekib 20 külalist õigete laudade/tagidega; lisa vigane rida ning kontrolli, et ülejäänud 20 imporditakse ja vigase rea number kuvatakse. Kontrolli eksport→import ringi, jutumärke, komasid, tühja nime ja tundmatut lauda.
4. Kontrolli 390 px vaates kõiki vahekaarte, pikki nimesid ja dialooge: `scrollWidth ≤ clientWidth`, puutealad ≥44 px; määra ja vaheta lauda ainult puudutustega.
5. Puhta salvestusega on kõik ekspordid lukus ja eelvaade vesimärgiga; kontrolli ostunupu sihti, vale/õiget taastamiskoodi ning `?paid=1` järel õiguse säilimist värskendamisel.
6. Ekspordi kõik kolm stiili; kontrolli PDF-i A2 mõõtu, valitavat teksti, kõiki paigutatud nimesid ja visuaalseid erinevusi. 200 külalise/25 lauaga ning pikkade nimedega kontrolli lehekülgede jätkumist ja kattumise puudumist; PNG mõõdud on eelvaate omadest 2×.
7. Skanni hostitud aadressi QR telefoniga: nimeotsing leiab õige laua; testi samanimelisi, paigutamata külalist, puuduvat vastet, vigast fragmenti ja QR mahupiiri.
8. Käivita iga uue JS-faili puhul `node --check`; Network-paneelis pole laadimise järel päringuid. Uues HTML/CSS/JS-is pole kõvakodeeritud HTTP(S)-aadresse peale `PAYMENT_URL`; vendor-failide olemasolevad litsentsiviited jäävad alles.

## Piirid
Ei tootekoodi selles planeerimisetapis; teostuses ei lisata loetlemata faile, teeke, fonte, raamistikke, ehitustööriistu ega TypeScripti.
Ei backendit, kontosid, autentimist, andmebaasi, analüütikat, küpsiseid, e-posti kogumist, AI-paigutust ega lisakeeli; PDF ei tohi olla kuvatõmmis.
