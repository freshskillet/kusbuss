# KusBuss

Tallinna ühistranspordi peatuste tabloovaade Vue 3 ja Vite'iga. Rakendus näitab kuut näidispeatust, otsingut, lemmikuid, lähima peatuse leidmist ning sõidukite saabumisaja hinnangut.

## Käivitamine

```sh
npm install
npm run dev
```

Arendusserver vahendab päringud `/api/tallinn/*` aadressile `https://transport.tallinn.ee/*`. GPS-andmed loetakse `/api/tallinn/gps.txt` failist; päringu vea või tühja vastuse korral kuvab rakendus simuleeritud demoandmeid.

Lemmikpeatuste valik salvestatakse brauseri `localStorage`-isse. Lähima peatuse funktsioon vajab kasutaja asukohaluba ja turvalist konteksti (localhost või HTTPS).

## Tootmisversiooni ehitamine

```sh
npm run build
```
