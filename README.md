# KusBuss

Vue 3 rakendus Tallinna ühistranspordi ametliku sõiduplaani, peatuste ja reaalaja GPS-i vaatamiseks.

## Käivitamine

```sh
npm install
npm run dev
```

Arendusserver vahendab GPS-päringud `/api/tallinn/*` aadressile `https://transport.tallinn.ee/*`. Kui GPS-andmed pole saadaval, kasutatakse selgelt demoandmetena märgitud sõidukeid.

Reisiplaneerija jaoks loo Digitransiti API-portaalis tellimus, millel on juurdepääs Finland GTFS Routing API-le, ja lisa projekti juurkausta `.env.local` faili:

```text
DIGITRANSIT_SUBSCRIPTION_KEY=sinu_võti
```

Käivita arendusserver pärast faili muutmist uuesti. Võti lisatakse Digitransiti päringutele serveris; ära lisa seda lähtekoodi ega jaga avalikult.

## Ametlikud peatused, sõiduplaanid ja marsruudikuju

Rakendus kasutab Tallinna Linnatranspordi (TLT) GTFS-voogu aadressilt `https://eu-gtfs.remix.com/tallinn.zip`. Lisaks kasutatakse [Eesti ühistranspordiregistri GTFS-koondandmeid](https://eu-gtfs.remix.com/estonia_unified_gtfs.zip): lisatud on maakonnabussiliinid, mille mõni sõit teenindab Tallinna peatust, sealhulgas nende liinide muud sõiduvariandid. Maakonnaliinid on heleoranžid. Andmed sisaldavad sõite, peatusaegu, peatuste koordinaate, juurdepääsetavuse/platformi välju ja võimalusel teekondade kujusid. Tootmisandmete paketi saab uuendada:

```sh
npm run update:transit
```

Käsk laadib mõlemad värsked vood ja loob tihendatud faili `public/data/tallinn-gtfs.bin`. TLT voo sõiduplaanide kehtivus lõpeb **31.12.2026**; maakonnaliinide kehtivusaeg sõltub konkreetsest liinist. Andmeid tuleb uuendada vähemalt iga seitsme päeva järel; uuendamine ei käivitu automaatselt. Sõiduplaanide ja peatuste allikas on Peatus.ee/ühistranspordiregistri avalikud GTFS-andmed.

Reisiplaneerija kasutab Digitransiti Eesti ja Soome Routing API-t. Teekonnakaart näitab API tagastatud sõidu- ja kõnnimarsruute. Otsingus on TLT ja lisatud maakonnaliinide sõitude peatused.

GPS-voog ei sisalda sõidu ehk trip'i tunnust ega ametlikku hilinemisennustust. Seepärast kuvatakse hilinemine/varasem saabumine **hinnanguna**: sõiduki GPS-positsioon sobitatakse liini marsruudikujuga ning võrreldakse peatuse sõiduplaaniga. Kui sõidukit ei saa kindlalt marsruudiga sobitada, näidatakse ainult sõiduplaani aega. Maakonnaliinidele ei ole reaalaja GPS-voogu ühendatud ja need kuvatakse sõiduplaani järgi. Demoasukohtade põhjal ei kuvata päris hilinemisinfot.

Valitud reisi kaardil säilitatakse esimesena sobitatud sõiduki tunnus kuni reisi sulgemise või vahetamiseni. Kui sõiduk kaob GPS-voost, ei asendata seda automaatselt teise sama liini sõidukiga. Esialgne sobitus on siiski hinnanguline, mitte ametlik sõidutunnusel põhinev kinnitus; mitmetähendusliku sobituse korral sõidukit ei näidata.

Maakonnaliini juures olev link avab vastava liini Peatus.ee kaardi, kus saab võimaluse korral bussi asukohta vaadata. See ei kinnita hilinemist ega ümberistumisele jõudmist; Peatus.ee-s ei pruugi iga bussi asukoht saadaval olla.

GTFS-is saadaolevaid peatuseandmeid, näiteks platvormi, piirkonda ja ligipääsetavust, kasutatakse võimalusel. Muud rajatised, näiteks varjualune või istepingid, pole selles sõiduplaanivoo formaadis saadaval. Kaardi aluskiht on OpenStreetMap.

Reisiplaneerijas koondatakse lähedased samanimelised peatused üheks valikuks: otsing arvestab nende eri suundade ja platvormidega. Eri kohtades asuvaid samanimelisi peatusi eristatakse. Otsida saab väljumise või saabumise aja järgi ning liikuda varasemate/hilisemate aegade juurde 30-minutiliste sammudega. Peatuse tabloovaade kuvab valitud peatuskoha ametlikke väljumisaegu ja sobiva GPS-sõiduki korral hilinemise hinnangut.

Kõnniteekonnad, ümberistumised ja teekondade järjestuse arvutab Digitransit. Tallinna GPS-i näitamiseks sobitatakse Digitransiti sõit kohaliku sõiduplaaniga ainult siis, kui sobiv sõit on üheselt tuvastatav.

> Vite'i `/api/tallinn` ja `/api/digitransit` proxy'd töötavad arendusserveris. Tootmiskeskkonnas tuleb serveripoolsed vahendused ja Digitransiti võtme turvaline seadistus eraldi lisada.

## Tootmisversiooni ehitamine

```sh
npm run build
```
