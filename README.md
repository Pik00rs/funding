# Δ-NEUTRAL DESK — Hyperliquid Funding Scanner

Scanner d'opportunités de funding arbitrage (buy spot / short perp) sur Hyperliquid,
avec moyennes de funding **10h / 24h / 72h / 7j / 15j / 30j** pour distinguer le funding
*persistant* des spikes éphémères.

## Comment ça marche

```
GitHub Action (cron horaire)
   └─ scripts/fetch-funding.js
        ├─ GET snapshot (metaAndAssetCtxs)        → mark, OI, volume, funding courant
        ├─ GET fundingHistory 30j par asset       → calcule les moyennes annualisées
        └─ écrit funding-data.json (commit)
                 │
                 ▼
   funding-scanner.html  ──lit──► funding-data.json   (servi par GitHub Pages, même origine)
```

Pas besoin de stocker l'historique soi-même : l'endpoint `fundingHistory` de Hyperliquid
le fournit à la demande. Le script ne fetch l'historique que pour les assets dont l'OI
dépasse `MIN_OI` (défaut 500 000 $) pour limiter le nombre de requêtes.

## Arborescence du repo

```
.
├─ funding-scanner.html            # le dashboard (à la racine)
├─ funding-data.json               # généré par l'Action (ne pas éditer à la main)
├─ scripts/
│   └─ fetch-funding.js
└─ .github/
    └─ workflows/
        └─ funding-update.yml
```

## Mise en place (5 min)

1. Crée un repo GitHub et dépose les fichiers selon l'arborescence ci-dessus
   (renomme `funding-update.yml` et place-le dans `.github/workflows/`,
   mets `fetch-funding.js` dans `scripts/`).
2. **Settings → Actions → General → Workflow permissions** → coche
   *Read and write permissions* (pour que l'Action puisse committer le JSON).
3. Onglet **Actions** → sélectionne *Update funding data* → **Run workflow**
   (premier remplissage manuel). Vérifie qu'un `funding-data.json` apparaît.
4. **Settings → Pages** → Source: *Deploy from a branch* → branche `main`, dossier `/ (root)`.
   Ton dashboard sera dispo sur `https://<user>.github.io/<repo>/funding-scanner.html`.
5. Ensuite l'Action tourne automatiquement chaque heure et met le JSON à jour.

## Réglages

| Variable | Où | Effet |
|---|---|---|
| `MIN_OI` | env du workflow | seuil d'OI sous lequel on ne calcule pas les moyennes (réduit les requêtes) |
| `SLEEP_MS` | env du workflow | pause entre requêtes (anti rate-limit) |
| cron `5 * * * *` | workflow | fréquence de mise à jour (le funding HL est horaire) |

## Lecture du dashboard (en un coup d'œil)

Tu arrives, tu regardes 2 choses :

1. **Le verdict** (gros bandeau en haut) :
   - 🟢 *« N opportunités solides »* → il y a des coups à jouer maintenant.
   - 🟡 *« N à surveiller »* → rien de béton, quelques options correctes.
   - ⚪ *« Rien de net »* → marché calme, pas la peine de forcer.
2. **Les cartes** (juste en dessous) : les 4 meilleures opportunités, notées **A → D**,
   triées par fiabilité, avec une phrase qui résume tout.

Le **tableau complet** en bas sert à creuser / filtrer si tu veux aller plus loin.

### La note (A → D)
Combine quatre choses pour éviter de te faire piéger par un spike :
- **Rendement fiable** = `min(7j, 30j)` annualisé (conservateur, pas le « Now »).
- **Persistance** = funding positif sur toutes les fenêtres.
- **Liquidité** = OI / volume (pour entrer/sortir sans slippage).
- **Bonus spot** = +points si dispo en spot sur HL (marge unifiée).

### Badges
- **STABLE** = funding positif sur 24h, 7j *et* 30j (persistant).
- **PIC** = funding court terme ≫ long terme → récent, risque de retomber.
- **SPOT** = asset dispo aussi en spot sur HL → deux jambes dans le même compte.

> Outil de screening, pas un conseil financier. Le funding n'est pas contractuel et peut
> flip négatif — surveille, et garde un buffer de marge contre la liquidation du short.
