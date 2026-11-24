# KusBuss

Vue 3 rakendus Tallinna ühistranspordi ametliku sõiduplaani, peatuste ja reaalaja GPS-i vaatamiseks.

## Käivitamine

```sh
npm install
npm run dev
```

Arendusserver vahendab GPS-päringud `/api/tallinn/*` aadressile `https://transport.tallinn.ee/*`. Kui GPS-andmed pole saadaval, kasutatakse selgelt demoandmetena märgitud sõidukeid.

## Ametlikud peatused, sõiduplaanid ja marsruudikuju

Rakendus kasutab Tallinna Linnatranspordi (TLT) GTFS-voogu aadressilt `https://eu-gtfs.remix.com/tallinn.zip`. Lisaks kasutatakse [Eesti ühistranspordiregistri GTFS-koondandmeid](https://eu-gtfs.remix.com/estonia_unified_gtfs.zip): lisatud on maakonnabussiliinid, mille mõni sõit teenindab Tallinna peatust, sealhulgas nende liinide muud sõiduvariandid. Maakonnaliinid on heleoranžid. Andmed sisaldavad sõite, peatusaegu, peatuste koordinaate, juurdepääsetavuse/platformi välju ja võimalusel teekondade kujusid. Tootmisandmete paketi saab uuendada:

```sh
npm run update:transit
```

Käsk laadib mõlemad värsked vood ja loob tihendatud faili `public/data/tallinn-gtfs.bin`. TLT voo sõiduplaanide kehtivus lõpeb **31.12.2026**; maakonnaliinide kehtivusaeg sõltub konkreetsest liinist. Andmeid tuleb uuendada vähemalt iga seitsme päeva järel; uuendamine ei käivitu automaatselt. Sõiduplaanide ja peatuste allikas on Peatus.ee/ühistranspordiregistri avalikud GTFS-andmed.

Teekonnakaart joonistab võimalusel GTFS-i marsruudikuju järgi. Otsingus on TLT ja lisatud maakonnaliinide sõitude peatused. Ümberistumisel arvestatakse kuni 500 m kaugusel asuvate peatuste vahelise kõnniga.

GPS-voog ei sisalda sõidu ehk trip'i tunnust ega ametlikku hilinemisennustust. Seepärast kuvatakse hilinemine/varasem saabumine **hinnanguna**: sõiduki GPS-positsioon sobitatakse liini marsruudikujuga ning võrreldakse peatuse sõiduplaaniga. Kui sõidukit ei saa kindlalt marsruudiga sobitada, näidatakse ainult sõiduplaani aega. Maakonnaliinidele ei ole reaalaja GPS-voogu ühendatud ja need kuvatakse sõiduplaani järgi. Demoasukohtade põhjal ei kuvata päris hilinemisinfot.

GTFS-is saadaolevaid peatuseandmeid, näiteks platvormi, piirkonda ja ligipääsetavust, kasutatakse võimalusel. Muud rajatised, näiteks varjualune või istepingid, pole selles sõiduplaanivoo formaadis saadaval. Kaardi aluskiht on OpenStreetMap.

Reisiplaneerijas koondatakse lähedased samanimelised peatused üheks valikuks: otsing arvestab nende eri suundade ja platvormidega. Eri kohtades asuvaid samanimelisi peatusi eristatakse. Otsida saab väljumise või saabumise aja järgi ning liikuda varasemate/hilisemate aegade juurde 30-minutiliste sammudega. Peatuse tabloovaade kuvab valitud peatuskoha ametlikke väljumisaegu ja sobiva GPS-sõiduki korral hilinemise hinnangut.

Planeerija võrdleb ka otsesõite, mille järel saab sihtkohta kõndida kuni hinnanguliselt 1 km. Kõnnivahemaa on sirgjoonelisest kaugusest arvutatud ligikaudne hinnang, mitte jalakäijate teevõrgu marsruut; tegelik tee ja kõnniaeg võivad olla teistsugused. Kaardi katkendjoon näitab ainult hinnangulist suunda. Tulemuste võrdlemisel arvestatakse saabumisaega, ümberistumisi ja kõnni pikkust.

> Vite'i `/api/tallinn` proxy töötab arendusserveris. Tootmiskeskkonnas tuleb samaväärne proxy või serveripoolne GPS-andmete vahendus eraldi seadistada.

## Tootmisversiooni ehitamine

```sh
npm run build
```
