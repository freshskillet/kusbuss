# KusBuss

Vue 3 rakendus Tallinna ühistranspordi ametliku sõiduplaani, peatuste ja reaalaja GPS-i vaatamiseks.

## Käivitamine

```sh
npm install
npm run dev
```

Arendusserver vahendab GPS-päringud `/api/tallinn/*` aadressile `https://transport.tallinn.ee/*`. Kui GPS-andmed pole saadaval, kasutatakse selgelt demoandmetena märgitud sõidukeid.

## Ametlikud peatused, sõiduplaanid ja marsruudikuju

Rakendus kasutab Tallinna Linnatranspordi (TLT) GTFS-voogu aadressilt `https://eu-gtfs.remix.com/tallinn.zip`. Feed'i metaandmed nimetavad vedajaks Aktsiaselts Tallinna Linnatransporti ning sisaldavad kõigi voo liinide sõite, peatusaegu, peatuste koordinaate, juurdepääsetavuse/platformi välju ja teekondade kujusid. Tootmisandmete paketi saab uuendada:

```sh
npm run update:transit
```

Käsk laadib värske voo ja loob tihendatud faili `public/data/tallinn-gtfs.bin`. Rakenduse praegune andmestik kehtib kuni **31.12.2026**; uuenda seda pärast voo kehtivusaja muutumist. Sõiduplaanide ja peatuste andmete allikas on TLT/Peatus.ee avalik GTFS-voog.

Teekonnakaart joonistab GTFS-i marsruudikuju järgi, mitte ei ühenda peatusi sirgjoontega. Kaardil ja otsingus on kõik aktiivsete TLT sõitude teenindatavad peatused. Ümberistumisel arvestatakse kuni 500 m kaugusel asuvate peatuste vahelise kõnniga.

GPS-voog ei sisalda sõidu ehk trip'i tunnust ega ametlikku hilinemisennustust. Seepärast kuvatakse hilinemine/varasem saabumine **hinnanguna**: sõiduki GPS-positsioon sobitatakse liini marsruudikujuga ning võrreldakse peatuse sõiduplaaniga. Kui sõidukit ei saa kindlalt marsruudiga sobitada, näidatakse ainult sõiduplaani aega. Demoasukohtade põhjal ei kuvata päris hilinemisinfot.

GTFS-is saadaolevaid peatuseandmeid, näiteks platvormi, piirkonda ja ligipääsetavust, kasutatakse võimalusel. Muud rajatised, näiteks varjualune või istepingid, pole selles sõiduplaanivoo formaadis saadaval. Kaardi aluskiht on OpenStreetMap.

Reisiplaneerijas koondatakse lähedased samanimelised peatused üheks valikuks: otsing arvestab nende eri suundade ja platvormidega. Eri kohtades asuvaid samanimelisi peatusi eristatakse. Otsida saab väljumise või saabumise aja järgi ning liikuda varasemate/hilisemate aegade juurde 30-minutiliste sammudega. Peatuse tabloovaade kuvab valitud peatuskoha ametlikke väljumisaegu ja sobiva GPS-sõiduki korral hilinemise hinnangut.

Planeerija võrdleb ka otsesõite, mille järel saab sihtkohta kõndida kuni hinnanguliselt 1 km. Kõnnivahemaa on sirgjoonelisest kaugusest arvutatud ligikaudne hinnang, mitte jalakäijate teevõrgu marsruut; tegelik tee ja kõnniaeg võivad olla teistsugused. Kaardi katkendjoon näitab ainult hinnangulist suunda. Tulemuste võrdlemisel arvestatakse saabumisaega, ümberistumisi ja kõnni pikkust.

> Vite'i `/api/tallinn` proxy töötab arendusserveris. Tootmiskeskkonnas tuleb samaväärne proxy või serveripoolne GPS-andmete vahendus eraldi seadistada.

## Tootmisversiooni ehitamine

```sh
npm run build
```
