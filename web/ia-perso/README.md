# IA Perso Web — génération d’images

Cette application web est la version canonique d’IA Perso pour Safari/iPhone et Vercel.

## Invariants

- Une action utilisateur déclenche au maximum une génération distante.
- Aucun retry fournisseur automatique : AI Gateway reçoit `cf-aig-max-attempts: 1`.
- Aucun fallback vers un second GPU après un échec Cloudflare.
- En l’absence de configuration Cloudflare, un seul URL Pollinations est construit et rendu par le navigateur.
- Les références visuelles sont indépendantes de la génération et limitées à trois résultats Openverse.
- La recherche Openverse commence avec `mature=false`; `mature=true` n’est utilisé que pour compléter une liste de moins de trois références.
- Les miniatures Openverse utilisent `thumb/?compressed=true` pour réduire les données mobiles.

## Cloudflare Workers AI / AI Gateway

Variables Vercel facultatives :

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_AI_GATEWAY_ID` (facultatif, `default` sinon)

Le token doit rester côté serveur et disposer uniquement des permissions nécessaires à Workers AI / AI Gateway.

Routage actuel :

- 512×512 : `@cf/black-forest-labs/flux-2-klein-4b`
- 1024×1024 : `@cf/black-forest-labs/flux-1-schnell`

Le `requestId` est lié à une empreinte du prompt et de la taille. Un même `requestId` réutilisé avec un autre contenu est refusé avec HTTP 409. Le seed est dérivé du `requestId`, ce qui rend les retries réseau reproductibles.

AI Gateway garde les métriques mais pas le prompt ni l’image dans les logs grâce à `cf-aig-collect-log-payload: false`.

Ne pas activer de fournisseur tiers ou de mécanisme de facturation automatique dans ce chemin si l’objectif reste zéro dépense involontaire.

## ComfyUI local

IA Perso conserve un backend ComfyUI explicite et prioritaire lorsqu’une URL et un workflow API JSON sont présents dans le stockage local du navigateur :

- `ia-perso-comfy-url`
- `ia-perso-comfy-workflow`

Cible recommandée au 7 août 2026 :

- ComfyUI stable à jour (v0.30.2 ou plus récent compatible),
- workflow officiel FLUX.2 Klein 4B,
- `flux-2-klein-4b-fp8.safetensors` distillé,
- 4 étapes,
- `FluxKVCache` lorsqu’il améliore le workflow testé sur la machine locale.

La documentation ComfyUI indique environ 8,4 Go de VRAM pour le 4B distillé sur sa configuration de référence. Toujours tester le workflow local dans ComfyUI avant de l’exporter en API JSON.

## Validation

Depuis `web/ia-perso` :

```bash
npm run check
npm test
```

Les tests sont conçus pour ne consommer aucun quota GPU : les appels Cloudflare et Openverse sont simulés localement.
